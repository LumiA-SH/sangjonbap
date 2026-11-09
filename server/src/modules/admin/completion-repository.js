import {createHash} from 'node:crypto';
import {writeActionLog,lockCharacter} from '../../shared/game.js';
import {requireNoActiveBattle,currentKstDay} from '../../shared/actions.js';
import {adminTransaction,requireAdminRow,checkDuplicate,fail} from './transaction.js';
import {requestKey,invalid} from './master-service.js';
import {validId} from './service.js';
const version=row=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
const int=v=>Number.isInteger(v)&&v>=0&&v<=2147483647;
const reason=v=>{if(typeof v!=='string'||!v.trim()||v.length>500)invalid('수정 사유를 1~500자로 입력하세요.');return v.trim();};
function input(body,fields){const key=requestKey(body);if(Object.keys(body).some(k=>![...fields,'reason','expectedVersion','requestKey'].includes(k)))invalid('허용되지 않은 필드입니다.');return {key,reason:reason(body.reason)};}
function match(row,expected){if(typeof expected!=='string'||expected!==version(row))fail('ADMIN_EDIT_CONFLICT','조회 후 데이터가 변경됐습니다. 다시 조회하고 확인하세요.');}
export function createAdminCompletionRepository(pool){
 async function clue(c,id){const row=(await c.query('select * from public.clue where id=$1',[id])).rows[0];if(!row)fail('CLUE_NOT_FOUND','단서가 없습니다.',404);return row;}
 async function details(c,id){const row=(await c.query(`select c.id,c.hunter_grade,c.has_ability,c.ability_grade,c.daily_meal_count,c.daily_training_done,c.last_training_date::text,c.death_count,c.revive_count,c.hp,c.blood,c.status,
  coalesce((select jsonb_agg(cr.recipe_id::text order by cr.recipe_id) from public.character_recipe cr where cr.character_id=c.id),'[]'::jsonb) recipe_ids
  from public.game_character c where c.id=$1 and c.is_active`,[id])).rows[0];if(!row)fail('CHARACTER_NOT_FOUND','캐릭터가 없습니다.',404);return row;}
 return {
  async listAdminStorage(query='',after='0'){
   if(typeof query!=='string'||query.length>100||!(after==='0'||validId(after)))invalid('검색 조건을 확인하세요.');
   return (await pool.query(`select i.id::text item_id,i.name,i.is_active,coalesce(s.quantity,0) quantity from public.item i left join public.storage s on s.item_id=i.id
    where i.id>$2 and strpos(lower(i.name),lower($1))>0 order by i.id limit 100`,[query,after])).rows;
  },
  saveAdminStorage(actor,id,body){
   const {key,reason:why}=input(body,['quantity','expectedQuantity']);
   if(!validId(id)||!int(body.quantity)||!int(body.expectedQuantity))invalid('수량은 INTEGER 범위의 비음수 정수입니다.');
   return adminTransaction(pool,async c=>{
    await requireAdminRow(c,actor);await checkDuplicate(c,key);
    // Same item -> storage order as deposit/withdraw, including currently absent stock rows.
    if(!(await c.query('select id from public.item where id=$1 for update',[id])).rowCount)fail('ITEM_NOT_FOUND','아이템이 없습니다.',404);
    const old=(await c.query('select quantity from public.storage where item_id=$1 for update',[id])).rows[0];const before=old?.quantity??0;
    if(before!==body.expectedQuantity)fail('ADMIN_EDIT_CONFLICT','입출고로 수량이 변경됐습니다. 다시 조회하세요.');
    await c.query('insert into public.storage(item_id,quantity) values($1,$2) on conflict(item_id) do update set quantity=excluded.quantity',[id,body.quantity]);
    await writeActionLog(c,{adminUserId:actor,category:'ADMIN',actionType:'STORAGE_ADJUST',targetType:'ITEM',targetId:id,description:why,detail:{before,after:body.quantity,reason:why},requestKey:key});
    return {item_id:id,quantity:body.quantity};
   });
  },
  async listAdminClues(query='',after='0'){
   if(typeof query!=='string'||query.length>100||!(after==='0'||validId(after)))invalid('검색 조건을 확인하세요.');
   return (await pool.query('select id,title,area_id,is_public,is_discovered from public.clue where id>$2 and strpos(lower(title),lower($1))>0 order by id limit 100',[query,after])).rows;
  },
  async getAdminClue(id){const record=await clue(pool,id);return {record,version:version(record)};},
  saveAdminClue(actor,id,body){
   const fields=['title','content','related_target','area_id','is_public'],{key,reason:why}=input(body,fields);
   if(typeof body.title!=='string'||!body.title.trim()||body.title.length>100||typeof body.content!=='string'||body.content.length>10000||
    (body.related_target!==null&&(typeof body.related_target!=='string'||body.related_target.length>200))||!validId(body.area_id)||typeof body.is_public!=='boolean')invalid('단서 제목·내용·구역·공개 설정을 확인하세요.');
   return adminTransaction(pool,async c=>{
    const observed=id?await clue(c,id):null;
    // Match investigation area -> auth -> clue. Never take an area lock after a clue lock.
    const ids=[...new Set([observed?.area_id,body.area_id].filter(Boolean).map(String))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
    for(const area of ids)if(!(await c.query('select id from public.area where id=$1 for update',[area])).rowCount)fail('AREA_NOT_FOUND','구역이 없습니다.',404);
    await requireAdminRow(c,actor);await checkDuplicate(c,key);
    if(id)await c.query('select id from public.clue where id=$1 for update',[id]);
    const before=id?await clue(c,id):null;
    if(before){match(before,body.expectedVersion);
     if(String(before.area_id)!==body.area_id&&(await c.query('select 1 from public.investigation_result where clue_id=$1 and area_id<>$2 limit 1',[id,body.area_id])).rowCount)fail('CLUE_AREA_IN_USE','조사 결과에서 참조하는 단서는 다른 구역으로 옮길 수 없습니다.');
    }
    const values=fields.map(k=>body[k]);let saved=id;
    if(id)await c.query(`update public.clue set ${fields.map((k,i)=>`${k}=$${i+1}`).join(',')} where id=$6`,[...values,id]);
    else saved=(await c.query(`insert into public.clue(${fields.join(',')}) values($1,$2,$3,$4,$5) returning id`,values)).rows[0].id;
    const after=await clue(c,saved);
    await writeActionLog(c,{adminUserId:actor,category:'ADMIN',actionType:id?'CLUE_UPDATE':'CLUE_CREATE',targetType:'CLUE',targetId:saved,description:why,detail:{before,after,reason:why},requestKey:key});
    return {record:after,version:version(after)};
   });
  },
  async getAdminCharacterDetails(id){const record=await details(pool,id);return {record,version:version(record)};},
  saveAdminCharacterDetails(actor,id,body){
   const fields=['hunter_grade','has_ability','ability_grade','recipe_ids','daily_meal_count','daily_training_done','death_count','revive_count'];
   const {key,reason:why}=input(body,fields);
   if(!['B','A','S'].includes(body.hunter_grade)||typeof body.has_ability!=='boolean'||(body.has_ability?!['E','D','C','B','A','S'].includes(body.ability_grade):body.ability_grade!==null)||
    !int(body.daily_meal_count)||body.daily_meal_count>5||typeof body.daily_training_done!=='boolean'||!int(body.death_count)||!int(body.revive_count)||body.revive_count>body.death_count||
    !Array.isArray(body.recipe_ids)||body.recipe_ids.length>1000||body.recipe_ids.some(v=>!validId(v))||new Set(body.recipe_ids).size!==body.recipe_ids.length)invalid('등급·이능·일일 횟수·누적 횟수·레시피를 확인하세요.');
   return adminTransaction(pool,async c=>{
    await requireAdminRow(c,actor);await checkDuplicate(c,key);
    const character=await lockCharacter(c,id);if(!character)fail('CHARACTER_NOT_FOUND','캐릭터가 없습니다.',404);
    await requireNoActiveBattle(c,character);const before=await details(c,id);match(before,body.expectedVersion);
    if(body.death_count!==before.death_count||body.revive_count!==before.revive_count){
     const expectedDifference=character.status==='DEAD'?1:0;
     if(body.death_count-body.revive_count!==expectedDifference)invalid('누적 횟수는 현재 생사 상태와 일치해야 합니다. 생존·빈사는 사망=부활, 사망은 사망=부활+1입니다.');
    }
    const ids=[...new Set([...before.recipe_ids,...body.recipe_ids])].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
    for(const recipe of ids){if(!(await c.query('select id from public.recipe where id=$1 for share',[recipe])).rowCount)fail('RECIPE_NOT_FOUND','레시피가 없습니다.',404);
     if(body.recipe_ids.includes(recipe)&&!before.recipe_ids.includes(recipe)&&!(await c.query('select 1 from public.recipe_discovery where recipe_id=$1',[recipe])).rowCount)fail('RECIPE_NOT_DISCOVERED','최초 발견 전 레시피는 관리자 학습으로 우회할 수 없습니다.');}
    await c.query('delete from public.character_recipe where character_id=$1 and not(recipe_id=any($2::bigint[]))',[id,body.recipe_ids]);
    for(const recipe of body.recipe_ids)await c.query('insert into public.character_recipe(character_id,recipe_id) values($1,$2) on conflict do nothing',[id,recipe]);
    const day=await currentKstDay(c);
    const trainingDate=body.daily_training_done===before.daily_training_done?before.last_training_date:(body.daily_training_done?day:null);
    await c.query(`update public.game_character set hunter_grade=$2,has_ability=$3,ability_grade=$4,daily_meal_count=$5,daily_training_done=$6,
     last_training_date=$7::date,death_count=$8,revive_count=$9 where id=$1`,
     [id,body.hunter_grade,body.has_ability,body.ability_grade,body.daily_meal_count,body.daily_training_done,trainingDate,body.death_count,body.revive_count]);
    const after=await details(c,id);
    await writeActionLog(c,{adminUserId:actor,characterId:id,category:'ADMIN',actionType:'CHARACTER_DETAILS_UPDATE',targetType:'CHARACTER',targetId:id,description:why,detail:{before,after,reason:why},requestKey:key});
    return {record:after,version:version(after)};
   });
  }
 };
}
