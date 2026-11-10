import {AppError} from '../../shared/http.js';
import {lockCharacterPairByUser, changeInventoryQuantity, writeActionLog} from '../../shared/game.js';
import {actionTransaction, requireActionCharacter, rejectActionDuplicate, requireNoActiveBattle} from '../../shared/actions.js';

export function validateTransferItem(item) {
    if (!item?.is_active) throw new AppError(404, 'ITEM_NOT_FOUND', '존재하지 않거나 비활성화된 아이템입니다.');
    if (!item.transferable) throw new AppError(409, 'ITEM_NOT_TRANSFERABLE', '양도할 수 없는 아이템입니다.');
}

// Both transfer endpoints share ownership, sorted character locks and one transaction.
export function transferInventoryItem(pool, userId, targetId, itemId, quantity, key, {
    validateItem = validateTransferItem, actionType = 'ITEM_TRANSFER', description = '아이템 양도'
} = {}) {
    return actionTransaction(pool, async client => {
        const {provider, target} = await lockCharacterPairByUser(client, userId, targetId);
        await rejectActionDuplicate(client, key);
        requireActionCharacter(provider, {allowNearDeath: true});
        requireActionCharacter(target, {allowNearDeath: true});
        if (String(provider.id) === String(target.id)) throw new AppError(409, 'SELF_TRANSFER', '본인에게 양도할 수 없습니다.');
        await requireNoActiveBattle(client, provider);
        await requireNoActiveBattle(client, target);
        const item = (await client.query('select * from public.item where id=$1 for update', [itemId])).rows[0];
        validateItem(item);
        const owned = await changeInventoryQuantity(client, provider.id, itemId, -quantity);
        if (!owned.ok) throw new AppError(409, 'NOT_ENOUGH_ITEMS', '양도할 아이템이 부족합니다.');
        const existing = (await client.query('select quantity from public.inventory where character_id=$1 and item_id=$2', [target.id, itemId])).rows[0];
        if (Number(existing?.quantity || 0) + quantity > 2147483647) {
            throw new AppError(409, 'INVENTORY_LIMIT_CONFLICT', '수량 저장 범위를 초과합니다.');
        }
        const received = await changeInventoryQuantity(client, target.id, itemId, quantity);
        const result = {itemId, quantity, targetId, providerQuantity: owned.after, targetQuantity: received.after};
        const detail = {...result, providerId: String(provider.id), providerName: provider.name,
            targetName: target.name, itemName: item.name, transferRequestKey: key};
        await writeActionLog(client, {characterId: provider.id, category: 'ITEM', actionType,
            targetType: 'CHARACTER', targetId, description: `${description}: ${provider.name} → ${target.name}, ${item.name} ${quantity}개`, detail, requestKey: key});
        // The sender owns the unique request key; both rows commit or roll back together.
        await writeActionLog(client, {characterId: target.id, category: 'ITEM',
            actionType: actionType === 'BLOOD_PACK_TRANSFER' ? 'BLOOD_PACK_RECEIVE' : 'ITEM_RECEIVE',
            targetType: 'CHARACTER', targetId: provider.id,
            description: `아이템 수령: ${provider.name} → ${target.name}, ${item.name} ${quantity}개`, detail});
        return result;
    });
}
