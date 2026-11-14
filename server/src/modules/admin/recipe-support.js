import {AppError} from '../../shared/http.js';

const fail=(code,message,status=409)=>{throw new AppError(status,code,message);};
const ordered=ids=>[...new Set(ids.map(String))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);

export async function lockRecipeAreas(client,recipeId,areaRecipes) {
    // Match the area -> role -> recipe lock order of /admin/areas/:areaId/recipes.
    const original=recipeId?(await client.query(
        'select area_id::text from public.area_recipe where recipe_id=$1 order by area_id',
        [recipeId]
    )).rows.map(row=>row.area_id):[];
    const ids=ordered([...original,...areaRecipes.map(row=>row.area_id)]);

    for (const areaId of ids) {
        if (!(await client.query('select id from public.area where id=$1 for update',[areaId])).rowCount) {
            fail('AREA_NOT_FOUND','등장 구역이 없습니다.',404);
        }
    }
    return original;
}

export async function validateRecipeFoodLinks(client,recipeId,recipe,before) {
    // Preserve legacy test recipes when the selected food IDs have not changed.
    if (before&&String(recipe.result_item_id)===String(before.result_item_id)&&
        String(recipe.failure_item_id)===String(before.failure_item_id)) return;
    if (String(recipe.result_item_id)===String(recipe.failure_item_id)) {
        fail('RECIPE_FOOD_CONFLICT','완성 음식과 실패 요리는 다른 아이템이어야 합니다.',400);
    }

    const normal=(await client.query(
        'select f.is_failure,exists(select 1 from public.recipe r where r.failure_item_id=f.item_id and ($2::bigint is null or r.id<>$2)) used_as_failure '+
        'from public.food_config f join public.item i on i.id=f.item_id where f.item_id=$1 and i.is_active',
        [recipe.result_item_id,recipeId]
    )).rows[0];
    if (!normal||normal.is_failure||normal.used_as_failure) {
        fail('RECIPE_RESULT_NOT_FOOD','완성 음식은 활성 상태의 일반 음식 설정에서 선택하세요.',400);
    }

    const failure=(await client.query(
        'select f.is_failure from public.food_config f join public.item i on i.id=f.item_id where f.item_id=$1 and i.is_active',
        [recipe.failure_item_id]
    )).rows[0];
    if (!failure?.is_failure) {
        fail('RECIPE_FAILURE_NOT_FOOD','실패 요리는 실패 음식으로 등록된 아이템을 선택하세요.',400);
    }
}

export async function saveRecipeAreas(client,recipeId,areaRecipes,original) {
    const current=(await client.query(
        'select area_id::text from public.area_recipe where recipe_id=$1 order by area_id',
        [recipeId]
    )).rows.map(row=>row.area_id);
    if (JSON.stringify(current)!==JSON.stringify(original)) {
        fail('RECIPE_AREAS_EDIT_CONFLICT','등장 구역이 다른 관리자에 의해 변경됐습니다. 다시 조회하세요.');
    }

    const wanted=ordered(areaRecipes.map(row=>row.area_id));
    const discovered=(await client.query('select 1 from public.recipe_discovery where recipe_id=$1',[recipeId])).rowCount>0;
    if (discovered&&JSON.stringify(wanted)!==JSON.stringify(original)) {
        fail('RECIPE_DISCOVERY_HISTORY_PRESERVED','최초 발견한 레시피의 등장 구역을 추가하거나 제거할 수 없습니다.');
    }

    await client.query('delete from public.area_recipe where recipe_id=$1 and not(area_id=any($2::bigint[]))',[recipeId,wanted]);
    for (const row of areaRecipes) {
        await client.query(
            'insert into public.area_recipe(area_id,recipe_id,weight,drop_rate) values($1,$2,$3,$4) '+
            'on conflict(area_id,recipe_id) do update set weight=excluded.weight,drop_rate=excluded.drop_rate',
            [row.area_id,recipeId,row.weight,row.drop_rate]
        );
    }
}