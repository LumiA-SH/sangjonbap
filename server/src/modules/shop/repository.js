import {isBloodPack,validateBloodPack} from '../inventory/blood-pack.js';
import {currentKstDay, requireNoActiveBattle, requireActionCharacter} from '../../shared/actions.js';
import {AppError} from '../../shared/http.js';
import {lockCharacterByUser, changeCharacterResources, changeInventoryQuantity, writeActionLog} from '../../shared/game.js';
import {buyRecipeProduct} from '../../shared/recipes.js';

function requireCharacter(character) {
    if (!character) throw new AppError(404, 'CHARACTER_NOT_FOUND', '연결된 활성 캐릭터가 없습니다.');
}
function remaining(limit, purchased) {
    return limit === null ? null : Math.max(0, Number(limit) - Number(purchased));
}
function view(product, totals) {
    return {...product, personalRemaining: remaining(product.purchase_limit, totals.personal),
        globalRemaining: remaining(product.stock_limit, totals.total)};
}
async function rejectDuplicate(client, requestKey) {
    const found = await client.query('select id from public.action_log where request_key=$1', [requestKey]);
    if (found.rowCount) throw new AppError(409, 'DUPLICATE_REQUEST', '이미 사용된 requestKey입니다. 동일 키를 다시 구매에 사용할 수 없습니다.');
}

export function createShopRepository(pool) {
    return {
        async getShopProducts(userId) {
            // One statement keeps ownership, products and both counts in one snapshot.
            const result = await pool.query(
                `select c.id,c.status,coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order,p.id)
                  from (select s.id::text,s.item_id::text,s.recipe_id::text,coalesce(i.name,r.name) name,coalesce(i.description,r.description) description,i.effect_type,s.price,s.purchase_limit,s.stock_limit,s.daily_limit,s.sort_order,
                    exists(select 1 from public.character_recipe cr where cr.character_id=c.id and cr.recipe_id=s.recipe_id) learned,
case when i.effect_type='BLOOD_PACK' then greatest(0,1-coalesce((select quantity from public.blood_pack_purchase_day where character_id=c.id and purchase_date=(statement_timestamp() at time zone 'Asia/Seoul')::date),0))
when s.daily_limit is null then null else greatest(0,s.daily_limit-coalesce(t.daily,0)) end as "dailyRemaining",
                    case when s.recipe_id is not null and exists(select 1 from public.character_recipe cr where cr.character_id=c.id and cr.recipe_id=s.recipe_id) then 0
                    when s.purchase_limit is null then null else greatest(0,s.purchase_limit-coalesce(t.personal,0)) end as "personalRemaining",
                    case when s.stock_limit is null then null else greatest(0,s.stock_limit-coalesce(t.total,0)) end as "globalRemaining"
                    from public.shop_product s left join public.item i on i.id=s.item_id
                    left join public.recipe r on r.id=s.recipe_id
                    left join lateral (select sum(quantity) total,sum(quantity) filter(where character_id=c.id) personal,sum(quantity) filter(where character_id=c.id and coalesce(purchase_date,(created_at at time zone 'Asia/Seoul')::date)=(statement_timestamp() at time zone 'Asia/Seoul')::date) daily
                      from public.shop_purchase where product_id=s.id) t on true
                    where s.is_active and (i.is_active or (r.is_active and exists(select 1 from public.recipe_discovery d where d.recipe_id=r.id)))) p),'[]'::jsonb) products
                 from public.game_character c join public.auth_user u on u.character_id=c.id
                 where u.id=$1 and u.is_active and c.is_active`, [userId]
            );
            requireCharacter(result.rows[0]);
            return result.rows[0].products;
        },

        async buyProduct(userId, productId, quantity, requestKey) {
            const client = await pool.connect();
            try {
                await client.query('begin');
                await rejectDuplicate(client, requestKey);
                // All shop mutations: product -> ownership/character -> item -> inventory.
                const product = (await client.query('select * from public.shop_product where id=$1 for update', [productId])).rows[0];
                if (!product?.is_active) throw new AppError(404, 'PRODUCT_NOT_FOUND', '판매 중인 상품이 없습니다.');
                const before = await lockCharacterByUser(client, userId);
                await rejectDuplicate(client, requestKey);
                requireCharacter(before);
                requireActionCharacter(before,{allowNearDeath:true});
                await requireNoActiveBattle(client,before);
                if(product.recipe_id!=null) {
                    const result=await buyRecipeProduct(client,before,product,quantity,requestKey,await currentKstDay(client));
                    await client.query('commit');
                    return result;
                }
                const item = (await client.query('select * from public.item where id=$1 for update', [product.item_id])).rows[0];
                if (!item?.is_active) throw new AppError(409, 'ITEM_UNAVAILABLE', '판매할 수 없는 아이템입니다.');
                const pack=isBloodPack(item);

                const day=await currentKstDay(client);
                if(pack) {
                    validateBloodPack(item);
                    if(product.price!==0||product.daily_limit!==1)throw new AppError(409,'BLOOD_PACK_CONFIG_INVALID','혈액팩은 무료이며 일일 한도 1이어야 합니다.');
                    const purchased=(await client.query('select quantity from public.blood_pack_purchase_day where character_id=$1 and purchase_date=$2',[before.id,day])).rows[0];
                    if(quantity!==1||purchased)throw new AppError(409,'DAILY_LIMIT_EXCEEDED','혈액팩은 캐릭터별 하루 1개 구매할 수 있습니다.');
                }
                const daily=Number((await client.query("select coalesce(sum(quantity),0) quantity from public.shop_purchase where product_id=$1 and character_id=$2 and coalesce(purchase_date,(created_at at time zone 'Asia/Seoul')::date)=$3::date",[productId,before.id,day])).rows[0].quantity);
                if(product.daily_limit!==null&&quantity>product.daily_limit-daily)throw new AppError(409,'DAILY_LIMIT_EXCEEDED','일일 구매 한도를 초과했습니다.');
                // Product lock serializes the aggregate check and purchase insertion globally.
                const totals = (await client.query(
                    `select coalesce(sum(quantity),0) total,coalesce(sum(quantity) filter(where character_id=$2),0) personal
                     from public.shop_purchase where product_id=$1`, [productId, before.id]
                )).rows[0];
                const available = view(product, totals);
                if (available.personalRemaining !== null && quantity > available.personalRemaining) {
                    throw new AppError(409, 'PERSONAL_LIMIT_EXCEEDED', '개인 누적 구매 한도를 초과했습니다.');
                }
                if (available.globalRemaining !== null && quantity > available.globalRemaining) {
                    throw new AppError(409, 'OUT_OF_STOCK', '전체 잔여 재고가 부족합니다.');
                }
                const totalPrice = Number(product.price) * quantity;
                if (!Number.isSafeInteger(totalPrice)) throw new AppError(400, 'PURCHASE_TOO_LARGE', '구매 금액이 처리 범위를 초과했습니다.');
                if (Number(before.currency) < totalPrice) throw new AppError(409, 'NOT_ENOUGH_CURRENCY', '재화가 부족합니다.');
                const current = await client.query('select quantity from public.inventory where character_id=$1 and item_id=$2 for update', [before.id, item.id]);
                if (Number(current.rows[0]?.quantity || 0) + quantity > 2147483647) {
                    throw new AppError(409, 'INVENTORY_LIMIT_CONFLICT', '인벤토리 수량의 DB 저장 범위를 초과합니다.');
                }
                if(pack)await client.query('insert into public.blood_pack_purchase_day(character_id,purchase_date,quantity) values ($1,$2,1)',[before.id,day]);
                const character = await changeCharacterResources(client, before, {currency: -totalPrice});
                const inventory = await changeInventoryQuantity(client, before.id, item.id, quantity);
                const purchase = (await client.query(
                    `insert into public.shop_purchase(product_id,character_id,quantity,unit_price,total_price,request_key,purchase_date)
                     values ($1,$2,$3,$4,$5,$6,$7) returning id`, [productId,before.id,quantity,product.price,totalPrice,requestKey,day]
                )).rows[0];
                const result = {purchaseId: purchase.id, productId, itemId: item.id, quantity, unitPrice: product.price,
                    dailyRemaining:pack?0:product.daily_limit===null?null:product.daily_limit-daily-quantity,totalPrice, currency: Number(character.currency), inventoryQuantity: inventory.after,
                    personalRemaining: available.personalRemaining === null ? null : available.personalRemaining - quantity,
                    globalRemaining: available.globalRemaining === null ? null : available.globalRemaining - quantity};
                await writeActionLog(client, {
                    characterId: before.id, category: 'SHOP', actionType: 'SHOP_PURCHASE', targetType: 'SHOP_PRODUCT', targetId: productId,
                    description: `${item.name} ${quantity}개를 구매했습니다.`, requestKey,
                    detail: {...result, currency_before: Number(before.currency), inventory_before: inventory.before}
                });
                await client.query('commit');
                return result;
            } catch (error) {
                await client.query('rollback');
                if (error.code === '23505' && ['action_log_request_key_key', 'shop_purchase_request_key_key'].includes(error.constraint)) {
                    throw new AppError(409, 'DUPLICATE_REQUEST', '이미 사용된 requestKey입니다.');
                }
                throw error;
            } finally { client.release(); }
        }
    };
}
