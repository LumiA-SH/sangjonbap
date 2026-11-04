import {writeActionLog} from '../../shared/game.js';
import {adminTransaction,requireAdminRow,checkDuplicate,fail} from './transaction.js';
import {requestKey,invalid} from './master-service.js';
import {validId} from './service.js';

const fields=['result_grade','result_text','weight','is_unique','investigation_rate_value','clue_id','is_active'];
const percent=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100&&Number(n.toFixed(2))===n;
export function validateInvestigationConfig(body) {
    const key=requestKey(body);
    if(Object.keys(body).some(k=>![...fields,'rewards','requestKey'].includes(k)))invalid('허용되지 않은 조사 설정 필드입니다.');
    if(typeof body.result_grade!=='string'||!body.result_grade.trim()||body.result_grade.length>30||typeof body.result_text!=='string'||!body.result_text.trim())invalid('결과 등급과 내용이 필요합니다.');
    if(!Number.isInteger(body.weight)||body.weight<1||body.weight>2147483647||!percent(body.investigation_rate_value))invalid('가중치 또는 조사율 상승값을 확인하세요.');
    if(typeof body.is_unique!=='boolean'||typeof body.is_active!=='boolean'||(body.clue_id!==null&&!validId(body.clue_id)))invalid('활성·고유 결과·단서를 확인하세요.');
    if(!Array.isArray(body.rewards))invalid('보상 목록이 필요합니다.');
    const seen=new Set();
    for(const r of body.rewards){
        if(!r||Object.keys(r).some(k=>!['item_id','recipe_id','quantity','probability'].includes(k)))invalid('보상 형식이 잘못되었습니다.');
        if((r.item_id!=null)===(r.recipe_id!=null)||!validId(r.item_id??r.recipe_id)||!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>2147483647||!percent(r.probability)||(r.recipe_id!=null&&r.quantity!==1))invalid('보상 대상·수량·확률을 확인하세요.');
        const identity=`${r.recipe_id!=null?'recipe':'item'}:${r.item_id??r.recipe_id}`;if(seen.has(identity))invalid('보상 대상이 중복되었습니다.');seen.add(identity);
    }
    return key;
}
async function records(c,areaId) {
    return (await c.query(`select r.*,coalesce((select jsonb_agg(jsonb_build_object('item_id',w.item_id::text,'recipe_id',w.recipe_id::text,'quantity',w.quantity,'probability',w.probability) order by w.id)
        from public.investigation_reward w where w.investigation_result_id=r.id),'[]'::jsonb) rewards,
        (select row_to_json(d) from public.unique_discovery d where d.investigation_result_id=r.id) discovery
        from public.investigation_result r where r.area_id=$1 order by r.id`,[areaId])).rows;
}
export function createAdminInvestigationOperations(pool) {
    return {
        async getAdminInvestigation(areaId) {
            return {results:await records(pool,areaId),clues:(await pool.query('select id,title,is_discovered,first_discoverer_id,discovered_at from public.clue where area_id=$1 order by id',[areaId])).rows};
        },
        saveAdminInvestigation(actor,areaId,id,body) {
            const key=validateInvestigationConfig(body);
            return adminTransaction(pool,async c=>{
                if(!(await c.query('select id from public.area where id=$1 for update',[areaId])).rowCount)fail('AREA_NOT_FOUND','지역이 없습니다.',404);
                await requireAdminRow(c,actor);await checkDuplicate(c,key);
                const before=id?(await records(c,areaId)).find(r=>String(r.id)===id):null;
                if(id&&!before)fail('RESULT_NOT_FOUND','지역의 조사 결과가 없습니다.',404);
                if(before?.discovery&&before.is_unique!==body.is_unique)fail('DISCOVERY_HISTORY_PRESERVED','발견된 고유 결과의 고유 여부를 변경할 수 없습니다.');
                if(body.clue_id&&!(await c.query('select id from public.clue where id=$1 and area_id=$2 for share',[body.clue_id,areaId])).rowCount)fail('CLUE_NOT_FOUND','같은 지역의 단서를 선택하세요.',404);
                const sort=ids=>[...new Set(ids.filter(Boolean))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
                // Match investigation/battle discovery: recipe before item; never change discovery history.
                for(const recipeId of sort(body.rewards.map(r=>r.recipe_id)))if(!(await c.query('select id from public.recipe where id=$1 for share',[recipeId])).rowCount)fail('RECIPE_NOT_FOUND','레시피가 없습니다.',404);
                for(const itemId of sort(body.rewards.map(r=>r.item_id)))if(!(await c.query('select id from public.item where id=$1 for share',[itemId])).rowCount)fail('ITEM_NOT_FOUND','아이템이 없습니다.',404);
                const values=fields.map(k=>body[k]);
                const saved=(await c.query(id?`update public.investigation_result set ${fields.map((k,i)=>`${k}=$${i+1}`).join(',')} where id=$8 and area_id=$9 returning *`:
                    `insert into public.investigation_result(${fields.join(',')},area_id) values(${values.map((_,i)=>`$${i+1}`).join(',')},$8) returning *`,id?[...values,id,areaId]:[...values,areaId])).rows[0];
                await c.query('delete from public.investigation_reward where investigation_result_id=$1',[saved.id]);
                for(const r of body.rewards)await c.query('insert into public.investigation_reward(investigation_result_id,item_id,recipe_id,quantity,probability) values($1,$2,$3,$4,$5)',[saved.id,r.item_id??null,r.recipe_id??null,r.quantity,r.probability]);
                const after=(await records(c,areaId)).find(r=>String(r.id)===String(saved.id));
                await writeActionLog(c,{adminUserId:actor,category:'ADMIN',actionType:id?'INVESTIGATION_RESULT_UPDATE':'INVESTIGATION_RESULT_CREATE',targetType:'INVESTIGATION_RESULT',targetId:saved.id,description:'조사 결과·보상 설정 변경',detail:{before,after},requestKey:key});
                return after;
            });
        }
    };
}
