import {createHash} from 'node:crypto';
import {AppError} from '../../shared/http.js';
import {adminTransaction,requireAdminRow,checkDuplicate} from '../admin/transaction.js';
import {requestKey} from '../admin/master-service.js';
import {writeActionLog} from '../../shared/game.js';
import {contentTime} from './repository.js';

const fail=(message,code='INVALID_EVENT',status=400)=>{throw new AppError(status,code,message);};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const version=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function validateEvent(value,storageOrigin){
 const keys=['title','body','imageUrl','startAt','endAt','active','featured'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))fail('이벤트 입력 항목을 확인하세요.');
 for(const [k,max] of [['title',100],['body',3000]])if(typeof value[k]!=='string'||!value[k].trim()||value[k].length>max)fail('제목과 내용을 입력하세요. 제목은 100자, 내용은 3000자까지입니다.');
 if(typeof value.active!=='boolean'||typeof value.featured!=='boolean')fail('활성 및 대표 여부를 확인하세요.');
 const start=contentTime(value.startAt),end=contentTime(value.endAt);
 if(start!==null&&end!==null&&end<start)fail('종료일은 시작일보다 빠를 수 없습니다.');
 if(value.imageUrl!==null){
  let image;try{image=new URL(value.imageUrl);}catch{fail('업로드한 이미지를 선택하세요.');}
  if(!storageOrigin||image.origin!==storageOrigin||image.search||image.hash||!/^\/storage\/v1\/object\/public\/survival-images\/events\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(image.pathname))fail('이벤트 파일 업로드로 등록한 이미지만 사용할 수 있습니다.');
 }
 return {...value,title:value.title.trim(),body:value.body.trim()};
}
export const eventVisible=(event,now)=>event.active&&(!event.startAt||now>=Date.parse(event.startAt))&&(!event.endAt||now<Date.parse(event.endAt));
export function createEventRepository(pool,{env={}}={}){
 const storageOrigin=env.SUPABASE_URL?new URL(env.SUPABASE_URL).origin:null;
 async function read(c,lock=false){
  const row=(await c.query("select config_value,clock_timestamp() as server_now from public.system_config where config_key='public_events'"+(lock?' for update':''))).rows[0];
  if(!row)fail('이벤트 설정이 설치되지 않았습니다.','EVENTS_NOT_CONFIGURED',503);
  return row;
 }
 const view=row=>({records:row.config_value.items,version:version(row.config_value)});
 return {
  async getAdminEvents(){return view(await read(pool));},
  async getPublicEvents(id=null){
   const row=await read(pool),now=new Date(row.server_now).getTime();
   const records=row.config_value.items.filter(x=>eventVisible(x,now)).sort((a,b)=>b.id-a.id);
   if(id){const record=records.find(x=>x.id===id);if(!record)fail('공개된 이벤트를 찾을 수 없습니다.','EVENT_NOT_FOUND',404);return {record};}
   return {records,featured:records.find(x=>x.featured)||null,serverNow:new Date(row.server_now).toISOString()};
  },
  async saveAdminEvent(actor,id,body,remove=false){
   const allowed=remove?['expectedVersion','requestKey']:['record','expectedVersion','requestKey'];
   if(!body||Object.keys(body).length!==allowed.length||allowed.some(k=>!Object.hasOwn(body,k)))fail('저장 요청을 확인하세요.');
   const key=requestKey(body),record=remove?null:validateEvent(body.record,storageOrigin);
   return adminTransaction(pool,async c=>{
    await requireAdminRow(c,actor);await checkDuplicate(c,key);
    const row=await read(c,true),before=row.config_value;
    if(body.expectedVersion!==version(before))fail('다른 관리자가 수정했습니다. 목록을 다시 불러오세요.','EVENT_CHANGED',409);
    const old=id?before.items.find(x=>x.id===id):null;
    if(id&&!old)fail('이벤트를 찾을 수 없습니다.','EVENT_NOT_FOUND',404);
    if(!id&&before.items.length>=100)fail('이벤트는 최대 100개까지 등록할 수 있습니다.');
    if(record?.featured&&before.items.some(x=>x.id!==id&&x.featured))fail('기존 대표 이벤트의 지정을 해제한 뒤 저장하세요.','EVENT_FEATURED_CONFLICT',409);
    const now=new Date(row.server_now).toISOString(),saved=remove?null:{...record,id:id||String(before.nextId),createdAt:old?.createdAt||now,updatedAt:now};
    const after={nextId:before.nextId+(id?0:1),items:before.items.filter(x=>x.id!==id)};
    if(saved)after.items.push(saved);
    await c.query("update public.system_config set config_value=$1::jsonb where config_key='public_events'",[JSON.stringify(after)]);
    await writeActionLog(c,{adminUserId:actor,category:'ADMIN',actionType:remove?'EVENT_DELETE':id?'EVENT_UPDATE':'EVENT_CREATE',description:'이벤트 관리',detail:{before:old,after:saved},requestKey:key});
    return {...view({config_value:after}),record:saved};
   });
  }
 };
}
