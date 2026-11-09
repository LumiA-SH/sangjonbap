import {createHash} from 'node:crypto';
import {AppError} from '../../shared/http.js';
import {adminTransaction,requireAdminRow,checkDuplicate} from '../admin/transaction.js';
import {requestKey} from '../admin/master-service.js';
import {writeActionLog} from '../../shared/game.js';
export const contentDefaults={world:{title:'',body:'',published:false},system:{items:[]},schedule:{title:'',body:'',startAt:null,endAt:null,published:false,items:[]}};
const fail=(message='안내 입력값을 확인하세요.',code='INVALID_CONTENT',status=400)=>{throw new AppError(status,code,message);};
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();};
const text=(v,max)=>{if(typeof v!=='string'||v.length>max)fail();};
const kindCheck=kind=>{if(!Object.hasOwn(contentDefaults,kind))fail();};
function published(v){if(typeof v.published!=='boolean')fail();text(v.title,100);text(v.body,3000);if(v.published&&!v.title.trim())fail('공개 항목에는 제목이 필요합니다.');}
export function contentTime(value){
 if(value===null)return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(value))fail('시간대가 포함된 날짜·시간을 입력하세요.');
 if(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)fail('유효한 시간이 아닙니다.');
 const [y,m,d]=value.slice(0,10).split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
 const n=Date.parse(value);if(y<2000||y>9999||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d||!Number.isFinite(n))fail('유효한 날짜가 아닙니다.');return n;
}
function period(v){const s=contentTime(v.startAt),e=contentTime(v.endAt);if((s===null)!==(e===null)||s!==null&&e<=s)fail('시작과 종료를 함께 입력하고 종료는 시작 이후로 지정하세요.');if(v.published&&s===null)fail('공개 일정에는 시작·종료 시각이 필요합니다.');}
export function validateContent(kind,v){
 kindCheck(kind);fields(v,Object.keys(contentDefaults[kind]));if(Buffer.byteLength(JSON.stringify(v),'utf8')>12000)fail('한 안내의 전체 내용은 UTF-8 12KB 이내입니다.');
 if(kind!=='system')published(v);if(kind==='world'){if(v.published&&!v.body.trim())fail('공개 세계관의 본문을 입력하세요.');return v;}
 if(kind==='schedule')period(v);
 if(!Array.isArray(v.items)||v.items.length>20)fail('항목은 최대 20개입니다.');const ids=new Set();
 for(const row of v.items){fields(row,['id','title','body','published','order',...(kind==='schedule'?['startAt','endAt']:[])]);published(row);
 if(typeof row.id!=='string'||!/^[-a-zA-Z0-9_]{1,60}$/.test(row.id)||ids.has(row.id)||!Number.isInteger(row.order)||row.order<0||row.order>2147483647)fail();ids.add(row.id);if(kind==='schedule')period(row);
 }return v;
}
export const scheduleState=(start,end,now)=>now<contentTime(start)?'UPCOMING':now>=contentTime(end)?'ENDED':'ONGOING';
const version=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function createPublicContentRepository(pool){
 async function read(c,kind,lock=false){kindCheck(kind);const row=(await c.query('select config_value,clock_timestamp() server_now from public.system_config where config_key=$1'+(lock?' for update':''),['public_'+kind])).rows[0];if(!row)fail('공개 안내 설정이 설치되지 않았습니다.','CONTENT_NOT_CONFIGURED',503);return row;}
 return {
 async getAdminContent(kind){const row=await read(pool,kind);return {content:row.config_value,version:version(row.config_value)};},
 async saveAdminContent(actor,kind,body){fields(body,['content','expectedVersion','requestKey']);const key=requestKey(body),content=validateContent(kind,body.content);
 return adminTransaction(pool,async c=>{await requireAdminRow(c,actor);await checkDuplicate(c,key);const row=await read(c,kind,true);if(body.expectedVersion!==version(row.config_value))fail('다른 관리자가 수정했습니다. 다시 조회하세요.','CONTENT_CHANGED',409);
 await c.query('update public.system_config set config_value=$2::jsonb where config_key=$1',['public_'+kind,JSON.stringify(content)]);
 await writeActionLog(c,{adminUserId:actor,category:'ADMIN',actionType:'PUBLIC_CONTENT_UPDATE',description:'공개 안내 수정',detail:{kind,before:row.config_value,after:content},requestKey:key});return {content,version:version(content)};});},
 async getPublicContent(kind){const row=await read(pool,kind),v=validateContent(kind,row.config_value),now=new Date(row.server_now).getTime();
 const items=()=>v.items.filter(x=>x.published).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
 let content=null;
 if(kind==='world'&&v.published)content={title:v.title,body:v.body};
 if(kind==='system')content={items:items().map(({id,title,body})=>({id,title,body}))};
 if(kind==='schedule'&&v.published)content={title:v.title,body:v.body,startAt:v.startAt,endAt:v.endAt,state:scheduleState(v.startAt,v.endAt,now),items:items().map(({id,title,body,startAt,endAt})=>({id,title,body,startAt,endAt,state:scheduleState(startAt,endAt,now)}))};
 return {content,serverNow:new Date(row.server_now).toISOString()};
 }
 };
}
