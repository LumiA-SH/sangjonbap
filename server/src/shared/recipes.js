import {AppError} from './http.js';
import {requireActionCharacter} from './actions.js';
import {changeCharacterResources,writeActionLog} from './game.js';
import {chooseResult,winsReward,randomUnit} from '../modules/investigation/random.js';

export function recipePrice(grade) {
    const price={COMMON:2,RARE:3,SPECIAL:4}[grade];
    if (!price) throw new AppError(409,'RECIPE_GRADE_HOLD','레시피 등급을 운영자가 확인해야 합니다.');
    return price;
}

// Caller already owns character (and source battle/area) locks. Always before item locks.
export async function lockRecipeDrops(client, drops) {
    const ids=[...new Set(drops.filter(d=>d.recipe_id!=null).map(d=>String(d.recipe_id)))];
    if (!ids.length) return new Map();
    const recipes=(await client.query('select * from public.recipe where id=any($1::bigint[]) order by id for update',[ids])).rows;
    const discovered=new Set((await client.query('select recipe_id from public.recipe_discovery where recipe_id=any($1::bigint[])',[ids])).rows.map(d=>String(d.recipe_id)));
    return new Map(recipes.filter(r=>r.is_active&&!discovered.has(String(r.id))).map(r=>[String(r.id),r]));
}

// Snapshot filtering is read-only; settlement must lock and recheck live discovery state.
export async function filterDiscoveredRecipeDrops(client,drops) {
    const ids=drops.filter(d=>d.recipe_id!=null).map(d=>String(d.recipe_id));
    if (!ids.length) return drops;
    const found=new Set((await client.query('select recipe_id from public.recipe_discovery where recipe_id=any($1::bigint[])',[ids])).rows.map(d=>String(d.recipe_id)));
    return drops.filter(d=>d.recipe_id==null||!found.has(String(d.recipe_id)));
}

// 구역별 레시피 후보 조회.
// 레시피를 잠가 동시 최초 발견이 중복 처리되지 않도록 한다.
// 반드시 아이템 잠금보다 먼저 호출한다.
export async function lockAreaRecipeCandidates(client,areaId) {
    const candidates=(await client.query(`
        select ar.recipe_id,ar.weight,ar.drop_rate
        from public.area_recipe ar
        join public.recipe r on r.id=ar.recipe_id
        where ar.area_id=$1 and r.is_active
        order by ar.recipe_id
    `,[areaId])).rows;

    if (!candidates.length) return [];

    const recipes=await lockRecipeDrops(client,candidates);

    return candidates
        .filter(row=>recipes.has(String(row.recipe_id)))
        .map(row=>({
            ...row,
            recipe:recipes.get(String(row.recipe_id))
        }));
}

// 구역별 후보 중 레시피 최대 1종을 추첨한다.
// 이 함수는 lockAreaRecipeCandidates()로 잠근 후보를 전달받는다.
// 기존 최초 발견·무료 학습·상점 등록 로직을 그대로 재사용한다.
export async function discoverAreaRecipe(client,candidates,characterId,sourceType,sourceId,random=randomUnit) {
    if (!candidates.length) return null;

    const selected=chooseResult(candidates,random);
    if (!selected || !winsReward(selected.drop_rate,random)) return null;

    return discoverRecipe(client,characterId,selected.recipe,sourceType,sourceId);
}

export async function discoverRecipe(client,characterId,recipe,sourceType,sourceId) {
    if ((await client.query('select 1 from public.character_recipe where recipe_id=$1 limit 1',[recipe.id])).rowCount) {
        throw new AppError(409,'RECIPE_LEGACY_DISCOVERY_HOLD','기존 습득 기록이 있어 최초 발견 전환 정책 확인이 필요합니다.');
    }
    const price=recipePrice(recipe.discovery_grade);
    const first=await client.query(`insert into public.recipe_discovery(recipe_id,character_id,source_type,source_id)
                                    values($1,$2,$3,$4) on conflict(recipe_id) do nothing returning recipe_id`,[recipe.id,characterId,sourceType,sourceId]);
    if (!first.rowCount) return null;
    // The recipe lock also serializes FK-checked ownership inserts.
    const learned=await client.query(`insert into public.character_recipe(character_id,recipe_id)
                                      values($1,$2) on conflict do nothing returning recipe_id`,[characterId,recipe.id]);
    // No UPDATE/lock of an existing product: prevents product -> character -> recipe cycles.
    const product=(await client.query(`insert into public.shop_product(recipe_id,price,purchase_limit)
                                       values($1,$2,1) returning id`,[recipe.id,price])).rows[0];
    const result={recipeId:recipe.id,name:recipe.name,firstDiscovery:true,learned:true,newlyLearned:learned.rowCount>0,productId:product.id,price};
    await writeActionLog(client,{characterId,category:'RECIPE',actionType:'RECIPE_DISCOVERY',targetType:'RECIPE',targetId:recipe.id,
        description:'레시피 최초 발견·무료 습득·상점 등록',detail:{...result,sourceType,sourceId}});
    return result;
}

// The existing shop transaction owns product -> character before entering here.
export async function buyRecipeProduct(client,before,product,quantity,requestKey,day) {
    requireActionCharacter(before,{allowNearDeath:true});
    if (quantity!==1) throw new AppError(400,'RECIPE_PURCHASE_QUANTITY','레시피는 한 번에 하나만 습득할 수 있습니다.');
    const recipe=(await client.query('select * from public.recipe where id=$1 for share',[product.recipe_id])).rows[0];
    if (!recipe?.is_active) throw new AppError(409,'RECIPE_NOT_FOUND','활성 레시피가 없습니다.');
    if (!(await client.query('select 1 from public.recipe_discovery where recipe_id=$1',[recipe.id])).rowCount)
        throw new AppError(409,'RECIPE_NOT_DISCOVERED','아직 발견되지 않은 레시피입니다.');
    if ((await client.query('select 1 from public.character_recipe where character_id=$1 and recipe_id=$2',[before.id,recipe.id])).rowCount)
        throw new AppError(409,'RECIPE_ALREADY_LEARNED','이미 습득한 레시피입니다.');
    if (product.price!==recipePrice(recipe.discovery_grade)) throw new AppError(409,'RECIPE_PRICE_CONFLICT','레시피 등급과 판매 가격이 일치하지 않습니다.');
    if (Number(before.currency)<product.price) throw new AppError(409,'NOT_ENOUGH_CURRENCY','재화가 부족합니다.');
    const character=await changeCharacterResources(client,before,{currency:-product.price});
    await client.query('insert into public.character_recipe(character_id,recipe_id) values($1,$2)',[before.id,recipe.id]);
    const purchase=(await client.query(`insert into public.shop_purchase(product_id,character_id,quantity,unit_price,total_price,request_key,purchase_date)
                                        values($1,$2,1,$3::integer,$3::integer,$4,$5) returning id`,[product.id,before.id,product.price,requestKey,day])).rows[0];
    const result={purchaseId:purchase.id,productId:product.id,recipeId:recipe.id,quantity:1,unitPrice:product.price,totalPrice:product.price,
        learned:true,currencyBefore:Number(before.currency),currency:Number(character.currency),personalRemaining:0,globalRemaining:null,dailyRemaining:null};
    await writeActionLog(client,{characterId:before.id,category:'SHOP',actionType:'SHOP_PURCHASE',targetType:'SHOP_PRODUCT',targetId:product.id,
        description:`${recipe.name} 레시피 구매·습득`,detail:result,requestKey});
    return result;
}