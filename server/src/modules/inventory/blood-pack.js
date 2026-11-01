import {AppError} from '../../shared/http.js';
import {lockCharacterByUser,lockCharacterPairByUser,changeCharacterResources,changeInventoryQuantity,writeActionLog} from '../../shared/game.js';
import {actionTransaction,requireActionCharacter,rejectActionDuplicate,requireNoActiveBattle} from '../../shared/actions.js';

export const isBloodPack=item=>item?.effect_type==='BLOOD_PACK';
export function validateBloodPack(item) {
    if (!item?.is_active||!isBloodPack(item)||!item.usable||item.use_target!=='SELF'||!Number.isInteger(item.effect_value)||item.effect_value<=0||!item.transferable) throw new AppError(409,'BLOOD_PACK_CONFIG_INVALID','혈액팩 효과 설정이 올바르지 않습니다.');
}
export function createBloodPackRepository(pool) {
    return {
        useBloodPack(userId,itemId,key) {
            return actionTransaction(pool,async c=>{
                const before=await lockCharacterByUser(c,userId);await rejectActionDuplicate(c,key);
                requireActionCharacter(before,{allowNearDeath:true});
                const battle=await c.query("select id from public.battle where character_id=$1 and battle_status='ACTIVE' for share",[before.id]);
                // Keep the existing error code for clients; actual battle use is now a turn command.
                if(battle.rowCount)throw new AppError(409,'ITEM_BATTLE_POLICY_HOLD','전투 중 혈액팩은 전투 턴 API로 사용하세요.');
                const item=(await c.query('select * from public.item where id=$1 for update',[itemId])).rows[0];validateBloodPack(item);
                const inventory=await changeInventoryQuantity(c,before.id,itemId,-1);
                if(!inventory.ok)throw new AppError(409,'NOT_ENOUGH_ITEMS','혈액팩이 부족합니다.');
                const after=await changeCharacterResources(c,before,{blood:item.effect_value});
                const result={itemId,quantity:inventory.after,blood:after.blood,status:after.status};
                await writeActionLog(c,{characterId:before.id,category:'ITEM',actionType:'BLOOD_PACK_USE',targetType:'ITEM',targetId:itemId,
                    description:'혈액팩 사용',detail:{before:{blood:before.blood,status:before.status},after:result},requestKey:key});
                return result;
            });
        },
        transferBloodPack(userId,targetId,itemId,quantity,key) {
            return actionTransaction(pool,async c=>{
                const {provider,target}=await lockCharacterPairByUser(c,userId,targetId);await rejectActionDuplicate(c,key);
                requireActionCharacter(provider,{allowNearDeath:true});requireActionCharacter(target,{allowNearDeath:true});
                await requireNoActiveBattle(c,provider);
                await requireNoActiveBattle(c,target);
                if(provider.id===target.id)throw new AppError(409,'SELF_TRANSFER','본인에게 양도할 수 없습니다.');
                const item=(await c.query('select * from public.item where id=$1 for update',[itemId])).rows[0];validateBloodPack(item);
                const owned=await changeInventoryQuantity(c,provider.id,itemId,-quantity);
                if(!owned.ok)throw new AppError(409,'NOT_ENOUGH_ITEMS','혈액팩이 부족합니다.');
                const existing=(await c.query('select quantity from public.inventory where character_id=$1 and item_id=$2',[target.id,itemId])).rows[0];
                if(Number(existing?.quantity||0)+quantity>2147483647)throw new AppError(409,'INVENTORY_LIMIT_CONFLICT','수량 저장 범위를 초과합니다.');
                const received=await changeInventoryQuantity(c,target.id,itemId,quantity);
                const result={itemId,quantity,targetId,providerQuantity:owned.after,targetQuantity:received.after};
                await writeActionLog(c,{characterId:provider.id,category:'ITEM',actionType:'BLOOD_PACK_TRANSFER',targetType:'CHARACTER',targetId,
                    description:'혈액팩 양도',detail:result,requestKey:key});
                return result;
            });
        }
    };
}
