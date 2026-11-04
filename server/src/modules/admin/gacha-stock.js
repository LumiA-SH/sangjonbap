import {requireRpItem,validateStockChange} from '../gacha/rules.js';
import {fail} from './transaction.js';

// Caller holds the gacha parent and all referenced item locks. Keep reward IDs/history.
export async function saveGachaStock(client,gachaId,before,rewards) {
    const old=new Map((before?.rewards||[]).map(row=>[String(row.item_id),row]));
    const legacy=rewards.some(row=>row.max_stock!=null&&old.has(row.item_id)&&old.get(row.item_id).max_stock==null);
    if(legacy&&(await client.query("select 1 from public.action_log where action_type='GACHA_DRAW' and target_type='GACHA' and target_id=$1 limit 1",[gachaId])).rowCount)
        fail('GACHA_STOCK_MIGRATION_HOLD','과거 당첨 이력이 있는 보상의 재고 전환은 운영진 확정 대기입니다.');
    for(const row of rewards) {
        if(row.is_active===false&&row.max_stock===null&&row.remaining_stock===null) {
            if(!old.has(row.item_id)||old.get(row.item_id).max_stock!=null)fail('GACHA_STOCK_CONFLICT','설정된 재고를 미확정 상태로 되돌릴 수 없습니다.');
            await client.query('update public.gacha_reward set is_active=false where gacha_id=$1 and item_id=$2',[gachaId,row.item_id]);
            continue;
        }
        validateStockChange(old.get(row.item_id),row);
        if(row.is_active!==false||!old.has(row.item_id)) {
            const item=(await client.query('select * from public.item where id=$1',[row.item_id])).rows[0];
            requireRpItem(item);
            if((await client.query('select 1 from public.food_config where item_id=$1',[row.item_id])).rowCount)fail('GACHA_RP_ITEM_REQUIRED','음식 효과가 있는 아이템은 RP 보상으로 사용할 수 없습니다.');
        }
        await client.query(`insert into public.gacha_reward(gacha_id,item_id,quantity,weight,is_active,max_stock,remaining_stock)
            values($1,$2,1,1,$3,$4,$5) on conflict(gacha_id,item_id) do update set
            quantity=1,is_active=excluded.is_active,max_stock=excluded.max_stock,remaining_stock=excluded.remaining_stock`,
            [gachaId,row.item_id,row.is_active??true,row.max_stock,row.remaining_stock]);
    }
    // Omission is deactivation, never erase the historical capacity/awards.
    await client.query('update public.gacha_reward set is_active=false where gacha_id=$1 and not(item_id=any($2::bigint[]))',[gachaId,rewards.map(row=>row.item_id)]);
}
