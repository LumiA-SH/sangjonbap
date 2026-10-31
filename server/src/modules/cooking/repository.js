import {AppError} from '../../shared/http.js';
import {lockCharacterByUser, changeCharacterResources, changeInventoryQuantity, writeActionLog} from '../../shared/game.js';
import {readNumberSettings, resourceNumber} from '../../shared/settings.js';
import {winsReward, randomUnit} from '../investigation/random.js';

// Confirmed global rules; AP and permanent growth cap are SYSTEM_CONFIG values.
export const SUCCESS_QUANTITY = 4;
export const FAILURE_QUANTITY = 1;
export const DAILY_MEAL_LIMIT = 5;
const INT_MAX = 2147483647;
const fail = (code, message, status = 409) => { throw new AppError(status, code, message); };
function requireCharacter(character, action = false) {
    if (!character) fail('CHARACTER_NOT_FOUND', '연결된 활성 캐릭터가 없습니다.', 404);
    if (action && character.status === 'DEAD') fail('CHARACTER_DEAD', '사망한 캐릭터는 행동할 수 없습니다.');
    if (action && character.status === 'NEAR_DEATH') fail('CHARACTER_NEAR_DEATH', '빈사 상태의 요리·식사·습득 행동은 불가합니다.');
}
async function duplicate(client, requestKey) {
    if ((await client.query('select id from public.action_log where request_key=$1', [requestKey])).rowCount) {
        fail('DUPLICATE_REQUEST', '이미 사용된 requestKey입니다.');
    }
}
async function activeRecipe(client, id) {
    const row = (await client.query('select * from public.recipe where id=$1 for share', [id])).rows[0];
    if (!row?.is_active) fail('RECIPE_NOT_FOUND', '활성 레시피가 없습니다.', 404);
    return row;
}
async function lockItems(client, ids) {
    const items = new Map();
    const sorted = [...new Set(ids.filter(id => id !== null).map(String))].sort((a,b) => BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);
    for (const id of sorted) {
        const row = (await client.query('select * from public.item where id=$1 for update', [id])).rows[0];
        if (!row?.is_active) fail('ITEM_UNAVAILABLE', '사용할 수 없는 아이템이 설정되어 있습니다.');
        items.set(id,row);
    }
    return items;
}
async function inventoryQuantities(client, characterId, ids) {
    const rows = await client.query('select item_id,quantity from public.inventory where character_id=$1 and item_id=any($2::bigint[]) order by item_id for update', [characterId,ids]);
    return new Map(rows.rows.map(row=>[String(row.item_id),Number(row.quantity)]));
}

export function createCookingRepository(pool, {random = randomUnit} = {}) {
    async function transact(userId, requestKey, action, work) {
        const client = await pool.connect();
        try {
            await client.query('begin');
            await duplicate(client, requestKey);
            const character = await lockCharacterByUser(client, userId);
            await duplicate(client, requestKey);
            requireCharacter(character, true);
            if (action==='EAT' && (await client.query("select id from public.battle where character_id=$1 and battle_status='ACTIVE' for share",[character.id])).rowCount) {
                fail('BATTLE_ITEM_COMMAND_REQUIRED','전투 중 아이템은 전투 턴 API로만 사용할 수 있습니다.');
            }
            const result = await work(client, character);
            await writeActionLog(client, {characterId: character.id, category: 'COOKING', actionType: action,
                targetType: action === 'EAT' ? 'ITEM' : 'RECIPE', targetId: result.itemId || result.recipeId,
                description: {LEARN_RECIPE:'레시피를 습득했습니다.',COOK:'요리를 시도했습니다.',EAT:'음식을 먹었습니다.'}[action],
                detail: result, requestKey});
            await client.query('commit');
            return result;
        } catch (error) {
            await client.query('rollback');
            if (error.code === '23505' && error.constraint === 'action_log_request_key_key') fail('DUPLICATE_REQUEST', '이미 사용된 requestKey입니다.');
            throw error;
        } finally { client.release(); }
    }
    return {
        async getCookingCatalog(userId) {
            const c = (await pool.query(`select c.* from public.game_character c join public.auth_user u on u.character_id=c.id
                where u.id=$1 and u.is_active and c.is_active`, [userId])).rows[0];
            requireCharacter(c);
            const {cooking_ap_cost: cookingApCost} = await readNumberSettings(pool, {cooking_ap_cost: resourceNumber});
            const recipes = (await pool.query(`select r.*,exists(select 1 from public.character_recipe cr where cr.character_id=$1 and cr.recipe_id=r.id) learned,
                coalesce((select jsonb_agg(jsonb_build_object('itemId',ri.item_id::text,'name',i.name,'quantity',ri.quantity) order by ri.item_id)
                from public.recipe_ingredient ri join public.item i on i.id=ri.item_id where ri.recipe_id=r.id),'[]'::jsonb) ingredients
                from public.recipe r where r.is_active order by r.id`, [c.id])).rows;
            const foods = (await pool.query(`select f.*,i.name,v.quantity from public.inventory v join public.item i on i.id=v.item_id
                join public.food_config f on f.item_id=i.id where v.character_id=$1 and v.quantity>0 and i.is_active order by i.id`, [c.id])).rows;
            return {recipes,foods,cookingApCost,dailyMealLimit: DAILY_MEAL_LIMIT,dailyMealCount:c.daily_meal_count,
                successQuantity:SUCCESS_QUANTITY,failureQuantity:FAILURE_QUANTITY};
        },
        async learnRecipe(userId, recipeId, requestKey) {
            return transact(userId, requestKey, 'LEARN_RECIPE', async (client, before) => {
                const recipe = await activeRecipe(client, recipeId);
                if ((await client.query('select 1 from public.character_recipe where character_id=$1 and recipe_id=$2', [before.id,recipeId])).rowCount) {
                    fail('RECIPE_ALREADY_LEARNED', '이미 습득한 레시피입니다.');
                }
                if (Number(before.currency) < recipe.learn_cost) fail('NOT_ENOUGH_CURRENCY', '재화가 부족합니다.');
                const after = await changeCharacterResources(client, before, {currency:-recipe.learn_cost});
                await client.query('insert into public.character_recipe(character_id,recipe_id) values ($1,$2)', [before.id,recipeId]);
                return {recipeId,cost:recipe.learn_cost,currencyBefore:before.currency,currency:after.currency};
            });
        },
        async cookRecipe(userId, recipeId, requestKey) {
            return transact(userId, requestKey, 'COOK', async (client, before) => {
                const recipe = await activeRecipe(client, recipeId);
                if (!(await client.query('select 1 from public.character_recipe where character_id=$1 and recipe_id=$2', [before.id,recipeId])).rowCount) fail('RECIPE_NOT_LEARNED', '먼저 레시피를 습득하세요.');
                if (recipe.result_quantity !== SUCCESS_QUANTITY || (Number(recipe.success_rate)<100 && !recipe.failure_item_id)) {
                    fail('RECIPE_CONFIG_INVALID', '성공 수량은 4여야 하며 실패 가능한 레시피에는 실패 음식이 필요합니다.', 500);
                }
                const {cooking_ap_cost: cost} = await readNumberSettings(client, {cooking_ap_cost:resourceNumber});
                if (Number(before.ap)<cost) fail('NOT_ENOUGH_AP', '요리에 필요한 AP가 부족합니다.');
                const ingredients = (await client.query('select * from public.recipe_ingredient where recipe_id=$1 order by item_id for share', [recipeId])).rows;
                if (!ingredients.length) fail('RECIPE_CONFIG_INVALID', '재료가 등록되지 않은 레시피입니다.', 500);
                const items = await lockItems(client, [...ingredients.map(row=>row.item_id), recipe.result_item_id, recipe.failure_item_id]);
                const quantities = await inventoryQuantities(client, before.id, [...items.keys()]);
                for (const row of ingredients) {
                    if ((quantities.get(String(row.item_id)) || 0)<row.quantity) fail('NOT_ENOUGH_INGREDIENTS', '요리에 필요한 재료가 부족합니다.');
                }
                const succeeded = winsReward(recipe.success_rate, random);
                const outputId = String(succeeded ? recipe.result_item_id : recipe.failure_item_id);
                const outputQuantity = succeeded ? SUCCESS_QUANTITY : FAILURE_QUANTITY;
                const consumed = ingredients.map(row=>({itemId:String(row.item_id),quantity:succeeded ? row.quantity : Math.floor(row.quantity/2)}));
                const outputAfter = (quantities.get(outputId)||0) - (consumed.find(row=>row.itemId===outputId)?.quantity||0) + outputQuantity;
                if (outputAfter>INT_MAX) fail('INVENTORY_LIMIT_CONFLICT', '음식 수량이 저장 범위를 초과합니다.');
                const after = await changeCharacterResources(client,before,{ap:-cost});
                for (const row of consumed) if (row.quantity) await changeInventoryQuantity(client,before.id,row.itemId,-row.quantity);
                const granted = await changeInventoryQuantity(client,before.id,outputId,outputQuantity);
                return {recipeId,succeeded,consumed,output:{itemId:outputId,quantity:outputQuantity,inventoryQuantity:granted.after},apBefore:before.ap,ap:after.ap,apCost:cost};
            });
        },
        async eatFood(userId, itemId, requestKey) {
            return transact(userId, requestKey, 'EAT', async (client, before) => {
                if (before.daily_meal_count>=DAILY_MEAL_LIMIT) fail('DAILY_MEAL_LIMIT', '오늘 식사 횟수를 모두 사용했습니다.');
                await lockItems(client,[itemId]);
                const food = (await client.query('select * from public.food_config where item_id=$1 for share', [itemId])).rows[0];
                if (!food) fail('FOOD_NOT_FOUND', '음식 설정이 없는 아이템입니다.', 404);
                const quantities = await inventoryQuantities(client,before.id,[itemId]);
                if ((quantities.get(String(itemId))||0)<1) fail('NOT_ENOUGH_FOOD', '음식을 보유하고 있지 않습니다.');
                const {permanent_stat_cap:cap} = await readNumberSettings(client,{permanent_stat_cap:resourceNumber});
                const stats = {atk:before.atk,def:before.def,agi:before.agi};
                let growth = null;
                if (food.stat_growth_enabled) {
                    const stat = {ATK:'atk',DEF:'def',AGI:'agi'}[food.stat_growth_target];
                    if (!stat) fail('FOOD_CONFIG_INVALID','음식 성장 대상 설정 오류입니다.',500);
                    if (stats[stat]<cap && winsReward(food.stat_growth_rate,random)) {
                        const amount = Math.min(food.stat_growth_value,cap-stats[stat]);
                        growth={stat:food.stat_growth_target,before:stats[stat],after:stats[stat]+amount,amount};
                        stats[stat]+=amount;
                    }
                }
                const inventory = await changeInventoryQuantity(client,before.id,itemId,-1);
                const after = await changeCharacterResources(client,before,{blood:food.blood_recovery});
                await client.query('update public.game_character set atk=$1,def=$2,agi=$3,daily_meal_count=$4 where id=$5',
                    [stats.atk,stats.def,stats.agi,before.daily_meal_count+1,before.id]);
                return {itemId,inventoryQuantity:inventory.after,bloodBefore:before.blood,blood:after.blood,
                    dailyMealCount:before.daily_meal_count+1,dailyMealLimit:DAILY_MEAL_LIMIT,growth,stats,permanentStatCap:cap};
            });
        }
    };
}
