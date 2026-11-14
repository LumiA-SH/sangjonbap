import {AppError} from '../../shared/http.js';
import {lockCharacterByUser,changeCharacterResources,changeInventoryQuantity,writeActionLog} from '../../shared/game.js';
import {actionTransaction,requireActionCharacter,rejectActionDuplicate} from '../../shared/actions.js';
import {transferInventoryItem} from './transfer.js';

export const isBloodPack=item=>item?.effect_type==='BLOOD_PACK';
export const isFreeBloodPack=item=>isBloodPack(item)&&item.blood_pack_kind==='FREE';

export function validateBloodPack(item) {
    if (!item?.is_active||!isBloodPack(item)||!['FREE','STANDARD'].includes(item.blood_pack_kind)||item.category!=='CONSUMABLE'||!item.usable||item.use_target!=='SELF'||!item.battle_usable||!item.transferable||Number(item.effect_value)!==(item.blood_pack_kind==='FREE'?10:30)) {
        throw new AppError(409,'BLOOD_PACK_CONFIG_INVALID','혈액팩 종류 또는 회복량 설정이 올바르지 않습니다.');
    }
}

export function createBloodPackRepository(pool) {
    return {
        useBloodPack(userId,itemId,key) {
            return actionTransaction(pool,async c=>{
                const before=await lockCharacterByUser(c,userId);
                await rejectActionDuplicate(c,key);
                requireActionCharacter(before,{allowNearDeath:true});

                const battle=await c.query("select id from public.battle where character_id=$1 and battle_status='ACTIVE' for share",[before.id]);

                // Keep the existing error code for clients; actual battle use is now a turn command.
                if(battle.rowCount)throw new AppError(409,'ITEM_BATTLE_POLICY_HOLD','전투 중 혈액팩은 전투 턴 API로 사용하세요.');

                const item=(await c.query('select * from public.item where id=$1 for update',[itemId])).rows[0];
                validateBloodPack(item);

                const inventory=await changeInventoryQuantity(c,before.id,itemId,-1);
                if(!inventory.ok)throw new AppError(409,'NOT_ENOUGH_ITEMS','혈액팩이 부족합니다.');

                const after=await changeCharacterResources(c,before,{blood:item.effect_value});
                const result={itemId,quantity:inventory.after,blood:after.blood,status:after.status};

                await writeActionLog(c,{
                    characterId:before.id,
                    category:'ITEM',
                    actionType:'BLOOD_PACK_USE',
                    targetType:'ITEM',
                    targetId:itemId,
                    description:'혈액팩 사용',
                    detail:{before:{blood:before.blood,status:before.status},after:result},
                    requestKey:key
                });

                return result;
            });
        },

        transferBloodPack(userId,targetId,itemId,quantity,key) {
            return transferInventoryItem(pool,userId,targetId,itemId,quantity,key,{
                validateItem:validateBloodPack,
                actionType:'BLOOD_PACK_TRANSFER',
                description:'혈액팩 양도'
            });
        }
    };
}