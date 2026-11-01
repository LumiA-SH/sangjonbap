import {requireNoActiveBattle} from '../../shared/actions.js';
import {AppError} from '../../shared/http.js';
import {lockCharacterByUser, changeCharacterResources, changeInventoryQuantity, writeActionLog} from '../../shared/game.js';
import {validateRewards, selectReward, requirePeriod} from './rules.js';

const fail = (code,message,status=409) => {throw new AppError(status,code,message);};
async function duplicate(client,key) {
    if ((await client.query('select id from public.action_log where request_key=$1',[key])).rowCount) fail('DUPLICATE_REQUEST','이미 사용된 requestKey입니다.');
}
export function createGachaRepository(pool,{random}={}) {
    return {
        async getGachaCatalog(userId) {
            const found = await pool.query(`select c.id from public.game_character c join public.auth_user u on u.character_id=c.id
                where u.id=$1 and u.is_active and c.is_active`,[userId]);
            if (!found.rowCount) fail('CHARACTER_NOT_FOUND','연결된 활성 캐릭터가 없습니다.',404);
            const result = await pool.query(`select g.id,g.name,g.price,g.start_at,g.end_at,
                coalesce(statement_timestamp()=start_at or statement_timestamp()=end_at,false) boundary,
                coalesce(statement_timestamp()<start_at,false) or coalesce(statement_timestamp()>end_at,false) outside
                from public.gacha g where g.is_active order by g.id`);
            return {gachas:result.rows};
        },
        async drawGacha(userId,gachaId,requestKey) {
            const client = await pool.connect();
            try {
                await client.query('begin');
                await duplicate(client,requestKey);
                // Character before all items, like inventory/cooking/shop. All item IDs ascending.
                const before = await lockCharacterByUser(client,userId);
                await duplicate(client,requestKey);
                if (!before) fail('CHARACTER_NOT_FOUND','연결된 활성 캐릭터가 없습니다.',404);
                if (before.status==='DEAD') fail('CHARACTER_DEAD','사망한 캐릭터는 가챠를 사용할 수 없습니다.');
                if (before.status==='NEAR_DEATH') fail('CHARACTER_NEAR_DEATH','빈사 상태의 가챠 행동은 불가합니다.');
                await requireNoActiveBattle(client,before);
                const gacha = (await client.query('select * from public.gacha where id=$1 for share',[gachaId])).rows[0];
                if (!gacha?.is_active) fail('GACHA_NOT_FOUND','활성 가챠가 없습니다.',404);
                const rewards = (await client.query('select * from public.gacha_reward where gacha_id=$1 order by id for share',[gachaId])).rows;
                validateRewards(rewards);
                const items = new Map();
                const ids = [...new Set(rewards.map(row=>String(row.item_id)))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);
                for (const id of ids) {
                    const item = (await client.query('select id,name,is_active from public.item where id=$1 for update',[id])).rows[0];
                    if (!item?.is_active) fail('GACHA_ITEM_UNAVAILABLE','비활성 보상 아이템이 설정되어 있습니다.',500);
                    items.set(id,item);
                }
                // Read actual database clock after any lock wait; preserve PostgreSQL microseconds.
                const period = (await client.query(`select coalesce(t.now=g.start_at or t.now=g.end_at,false) boundary,
                    coalesce(t.now<g.start_at,false) or coalesce(t.now>g.end_at,false) outside
                    from public.gacha g cross join (select clock_timestamp() as now) t where g.id=$1`,[gachaId])).rows[0];
                requirePeriod(period);
                if (before.currency<gacha.price) fail('NOT_ENOUGH_CURRENCY','재화가 부족합니다.');
                const selected = selectReward(rewards,random);
                const current = (await client.query('select quantity from public.inventory where character_id=$1 and item_id=$2 for update',[before.id,selected.item_id])).rows[0];
                if (Number(current?.quantity || 0)+selected.quantity>2147483647) fail('INVENTORY_LIMIT_CONFLICT','보상 수량이 DB 저장 범위를 초과합니다.');
                const character = await changeCharacterResources(client,before,{currency:-gacha.price});
                const inventory = await changeInventoryQuantity(client,before.id,selected.item_id,selected.quantity);
                const result = {gachaId,price:gacha.price,currencyBefore:before.currency,currency:character.currency,
                    reward:{id:selected.id,itemId:selected.item_id,name:items.get(String(selected.item_id)).name,quantity:selected.quantity},inventoryBefore:inventory.before,inventoryQuantity:inventory.after};
                await writeActionLog(client,{characterId:before.id,category:'GACHA',actionType:'GACHA_DRAW',targetType:'GACHA',targetId:gachaId,
                    description:`${gacha.name} 1회 추첨`,detail:result,requestKey});
                await client.query('commit');
                return result;
            } catch(error) {
                await client.query('rollback');
                if (error.code==='23505' && error.constraint==='action_log_request_key_key') fail('DUPLICATE_REQUEST','이미 사용된 requestKey입니다.');
                throw error;
            } finally {client.release();}
        }
    };
}
