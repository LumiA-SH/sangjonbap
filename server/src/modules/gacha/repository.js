import {requireNoActiveBattle} from '../../shared/actions.js';
import {AppError} from '../../shared/http.js';
import {lockCharacterByUser, changeCharacterResources, changeInventoryQuantity, writeActionLog} from '../../shared/game.js';
import {validateRewards, selectReward, requirePeriod,requireRpItem} from './rules.js';

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
            const result = await pool.query(`select g.id,g.name,1 as price,g.start_at,g.end_at,
                exists(select 1 from public.gacha_reward r where r.gacha_id=g.id and r.is_active and r.max_stock is null) as stock_hold,
                not exists(select 1 from public.gacha_reward r where r.gacha_id=g.id and r.is_active and r.remaining_stock>0) as sold_out,
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
                const gacha = (await client.query('select * from public.gacha where id=$1 for update',[gachaId])).rows[0];
                if (!gacha?.is_active) fail('GACHA_NOT_FOUND','활성 가챠가 없습니다.',404);
                const rewards = (await client.query('select * from public.gacha_reward where gacha_id=$1 and is_active order by id for update',[gachaId])).rows;
                validateRewards(rewards);
                const items = new Map();
                const ids = [...new Set(rewards.filter(row=>row.remaining_stock>0).map(row=>String(row.item_id)))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);
                for (const id of ids) {
                    const item = (await client.query('select * from public.item where id=$1 for update',[id])).rows[0];
                    requireRpItem(item);
                    if((await client.query('select 1 from public.food_config where item_id=$1',[id])).rowCount)fail('GACHA_RP_ITEM_REQUIRED','음식 효과가 연결된 아이템은 가챠 RP 보상으로 사용할 수 없습니다.');
                    items.set(id,item);
                }
                // Read actual database clock after any lock wait; preserve PostgreSQL microseconds.
                const period = (await client.query(`select coalesce(t.now=g.start_at or t.now=g.end_at,false) boundary,
                    coalesce(t.now<g.start_at,false) or coalesce(t.now>g.end_at,false) outside
                    from public.gacha g cross join (select clock_timestamp() as now) t where g.id=$1`,[gachaId])).rows[0];
                requirePeriod(period);
                if (before.currency<1) fail('NOT_ENOUGH_CURRENCY','가챠에는 코인 1개가 필요합니다.');
                const selected = selectReward(rewards,random);
                const current = (await client.query('select quantity from public.inventory where character_id=$1 and item_id=$2 for update',[before.id,selected.item_id])).rows[0];
                if (Number(current?.quantity || 0)+1>2147483647) fail('INVENTORY_LIMIT_CONFLICT','보상 수량이 DB 저장 범위를 초과합니다.');
                const stock=await client.query('update public.gacha_reward set remaining_stock=remaining_stock-1 where id=$1 and remaining_stock>0 returning remaining_stock',[selected.id]);
                if(!stock.rowCount)fail('GACHA_SOLD_OUT','보상이 품절되었습니다.');
                const character = await changeCharacterResources(client,before,{currency:-1});
                const inventory = await changeInventoryQuantity(client,before.id,selected.item_id,1);
                const item=items.get(String(selected.item_id));
                const result = {gachaId,price:1,currencyBefore:before.currency,currency:character.currency,
                    reward:{id:selected.id,itemId:selected.item_id,name:item.name,description:item.description,quantity:1},inventoryBefore:inventory.before,inventoryQuantity:inventory.after};
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
