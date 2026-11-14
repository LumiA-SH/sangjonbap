import {writeActionLog} from '../../shared/game.js';
import {adminTransaction,requireAdminRow,checkDuplicate,fail} from './transaction.js';
import {requestKey,invalid} from './master-service.js';
import {validId} from './service.js';

const fields=['is_failure','failure_selectable','result_grade','result_text','weight','is_unique','clue_id','is_active'];
const percent=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100&&Number(n.toFixed(2))===n;
const sortIds=ids=>[...new Set(ids.filter(Boolean).map(String))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);

export function validateInvestigationConfig(body) {
    if (!body || typeof body!=='object' || Array.isArray(body)) invalid('조사 설정을 확인하세요.');
    const key=requestKey(body);

    for (const k of ['is_failure','failure_selectable']) {
        if (k in body && typeof body[k]!=='boolean') invalid('실패 분류와 선택 포함 여부는 boolean입니다.');
    }

    if (Object.keys(body).some(k=>![...fields,'rewards','requestKey'].includes(k))) invalid('허용되지 않은 조사 설정 필드입니다.');
    if (typeof body.result_grade!=='string'||!body.result_grade.trim()||body.result_grade.length>30||typeof body.result_text!=='string'||!body.result_text.trim()) invalid('결과 등급과 내용이 필요합니다.');
    if (!Number.isInteger(body.weight)||body.weight<1||body.weight>2147483647) invalid('선택 가중치를 확인하세요.');
    if (typeof body.is_unique!=='boolean'||typeof body.is_active!=='boolean'||(body.clue_id!==null&&!validId(body.clue_id))) invalid('활성·고유 결과·단서를 확인하세요.');
    if (!Array.isArray(body.rewards)) invalid('보상 목록이 필요합니다.');

    const seen=new Set();

    for (const r of body.rewards) {
        if (!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['item_id','quantity','probability'].includes(k))) invalid('아이템 보상 형식이 올바르지 않습니다.');
        if (!validId(r.item_id)||!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>2147483647||!percent(r.probability)) invalid('보상 아이템·수량·확률을 확인하세요.');
        if (seen.has(r.item_id)) invalid('같은 아이템을 중복 등록할 수 없습니다.');
        seen.add(r.item_id);
    }

    return key;
}

export function validateAreaRecipeConfig(body) {
    if (!body || typeof body!=='object' || Array.isArray(body)) invalid('구역별 레시피 설정을 확인하세요.');
    const key=requestKey(body);

    if (Object.keys(body).some(k=>!['recipes','requestKey'].includes(k))||!Array.isArray(body.recipes)) invalid('레시피 목록이 필요합니다.');

    const seen=new Set();

    for (const row of body.recipes) {
        if (!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['recipe_id','weight','drop_rate'].includes(k))) invalid('레시피 배치 형식이 올바르지 않습니다.');
        if (!validId(row.recipe_id)||!Number.isInteger(row.weight)||row.weight<1||row.weight>2147483647||!percent(row.drop_rate)) invalid('레시피 ID·가중치·발견 확률을 확인하세요.');
        if (seen.has(row.recipe_id)) invalid('같은 레시피를 한 구역에 중복 등록할 수 없습니다.');
        seen.add(row.recipe_id);
    }

    return key;
}

async function records(c,areaId) {
    return (await c.query(
        `select r.*,coalesce((select jsonb_agg(jsonb_build_object(
            'item_id',w.item_id::text,'quantity',w.quantity,'probability',w.probability
        ) order by w.id)
        from public.investigation_reward w
        where w.investigation_result_id=r.id and w.item_id is not null),'[]'::jsonb) rewards,
        (select row_to_json(d) from public.unique_discovery d where d.investigation_result_id=r.id) discovery
        from public.investigation_result r where r.area_id=$1 order by r.id`,
        [areaId]
    )).rows;
}

async function areaRecipeRecords(c,areaId) {
    const rows=(await c.query(
        `select ar.recipe_id::text as recipe_id,r.name as recipe_name,
            ar.weight,ar.drop_rate,d.discovered_at
         from public.area_recipe ar
         join public.recipe r on r.id=ar.recipe_id
         left join public.recipe_discovery d on d.recipe_id=ar.recipe_id
         where ar.area_id=$1 order by ar.recipe_id`,
        [areaId]
    )).rows;

    return rows.map(row=>({
        recipe_id:row.recipe_id,
        recipe_name:row.recipe_name,
        weight:row.weight,
        drop_rate:Number(row.drop_rate),
        discovered:row.discovered_at!==null,
        discovered_at:row.discovered_at
    }));
}

export function createAdminInvestigationOperations(pool) {
    return {
        async getAdminInvestigation(areaId) {
            const results=await records(pool,areaId);
            const clues=(await pool.query(
                'select id,title,is_discovered,first_discoverer_id,discovered_at from public.clue where area_id=$1 order by id',
                [areaId]
            )).rows;
            const areaRecipes=await areaRecipeRecords(pool,areaId);

            return {results,clues,areaRecipes};
        },

        saveAdminInvestigation(actor,areaId,id,body) {
            const key=validateInvestigationConfig(body);

            return adminTransaction(pool,async c=>{
                if (!(await c.query('select id from public.area where id=$1 for update',[areaId])).rowCount) fail('AREA_NOT_FOUND','지역이 없습니다.',404);

                await requireAdminRow(c,actor);
                await checkDuplicate(c,key);

                const before=id?(await records(c,areaId)).find(r=>String(r.id)===String(id)):null;
                if (id&&!before) fail('RESULT_NOT_FOUND','지역의 조사 결과가 없습니다.',404);
                if (before?.discovery&&before.is_unique!==body.is_unique) fail('DISCOVERY_HISTORY_PRESERVED','발견된 고유 결과의 고유 여부를 변경할 수 없습니다.');

                if (body.clue_id && !(await c.query(
                    'select id from public.clue where id=$1 and area_id=$2 for share',
                    [body.clue_id,areaId]
                )).rowCount) fail('CLUE_NOT_FOUND','같은 지역의 단서를 선택하세요.',404);

                for (const itemId of sortIds(body.rewards.map(r=>r.item_id))) {
                    if (!(await c.query('select id from public.item where id=$1 for share',[itemId])).rowCount) fail('ITEM_NOT_FOUND','아이템이 없습니다.',404);
                }

                const values=fields.map(k=>['is_failure','failure_selectable'].includes(k)?(body[k]??before?.[k]??(k==='failure_selectable')):body[k]);

                const saved=(await c.query(
                    id ? `update public.investigation_result set ${fields.map((k,i)=>`${k}=$${i+1}`).join(',')}
                          where id=$${fields.length+1} and area_id=$${fields.length+2} returning *`
                        : `insert into public.investigation_result(${fields.join(',')},area_id)
                          values(${values.map((_,i)=>`$${i+1}`).join(',')},$${fields.length+1}) returning *`,
                    id?[...values,id,areaId]:[...values,areaId]
                )).rows[0];

                await c.query('delete from public.investigation_reward where investigation_result_id=$1',[saved.id]);

                for (const r of body.rewards) {
                    await c.query(
                        `insert into public.investigation_reward(investigation_result_id,item_id,quantity,probability)
                         values($1,$2,$3,$4)`,
                        [saved.id,r.item_id,r.quantity,r.probability]
                    );
                }

                const after=(await records(c,areaId)).find(r=>String(r.id)===String(saved.id));

                await writeActionLog(c,{
                    adminUserId:actor,category:'ADMIN',actionType:id?'INVESTIGATION_RESULT_UPDATE':'INVESTIGATION_RESULT_CREATE',
                    targetType:'INVESTIGATION_RESULT',targetId:saved.id,description:'조사 결과·아이템 보상 설정 변경',
                    detail:{before,after},requestKey:key
                });

                return after;
            });
        },

        saveAdminAreaRecipes(actor,areaId,body) {
            const key=validateAreaRecipeConfig(body);

            return adminTransaction(pool,async c=>{
                if (!(await c.query('select id from public.area where id=$1 for update',[areaId])).rowCount) fail('AREA_NOT_FOUND','지역이 없습니다.',404);

                await requireAdminRow(c,actor);
                await checkDuplicate(c,key);

                const before=await areaRecipeRecords(c,areaId);
                const recipeIds=sortIds(body.recipes.map(row=>row.recipe_id));
                const requested=new Set(recipeIds);

                // 이미 발견된 레시피의 구역 배치는 조사율 이력에 포함되므로 삭제하지 않는다.
                if (before.some(row=>row.discovered&&!requested.has(row.recipe_id))) {
                    fail('RECIPE_DISCOVERY_HISTORY_PRESERVED','이미 발견된 레시피는 구역 배치에서 제거할 수 없습니다.');
                }

                // 기존 레시피 잠금 순서와 일치시킨다.
                for (const recipeId of recipeIds) {
                    if (!(await c.query('select id from public.recipe where id=$1 for share',[recipeId])).rowCount) {
                        fail('RECIPE_NOT_FOUND','등록되지 않은 레시피입니다.',404);
                    }
                }

                await c.query(
                    'delete from public.area_recipe where area_id=$1 and not (recipe_id=any($2::bigint[]))',
                    [areaId,recipeIds]
                );

                for (const row of body.recipes) {
                    await c.query(
                        `insert into public.area_recipe(area_id,recipe_id,weight,drop_rate)
                         values($1,$2,$3,$4)
                         on conflict(area_id,recipe_id) do update
                         set weight=excluded.weight,drop_rate=excluded.drop_rate`,
                        [areaId,row.recipe_id,row.weight,row.drop_rate]
                    );
                }

                const after=await areaRecipeRecords(c,areaId);

                await writeActionLog(c,{
                    adminUserId:actor,category:'ADMIN',actionType:'AREA_RECIPES_UPDATE',
                    targetType:'AREA',targetId:areaId,description:'구역별 레시피 후보 설정 변경',
                    detail:{before,after},requestKey:key
                });

                return after;
            });
        }
    };
}