import {AppError} from '../../shared/http.js';
import {writeActionLog} from '../../shared/game.js';
import {adminTransaction,requireAdminRow,checkDuplicate} from './transaction.js';
import {requestKey} from './master-service.js';

export const eventNames=['death','revive','area_unlock','monster_discovery','clue_discovery','investigation_progress','story','raid','gacha','failure_food'];
export const policyDefaults={
 anemia:{enabled:false,stages:[]},
 donation:{enabled:false,cost:null,recovery:null,minimumRemaining:null,maximum:null,dailyLimitEnabled:false,dailyLimit:null},
 announcements:{events:Object.fromEntries(eventNames.map(name=>[name,{enabled:false,template:'',visibility:null,deduplicate:true,retryEnabled:false,maxAttempts:null,retryMinutes:null,thresholds:[]}]))},
 homepage:{enabled:false,accountId:null,noticeTag:null,eventTag:null,limit:null,publicOnly:true,excludeReplies:true,excludeBoosts:true},
 recovery:{recipe:'HOLD',gacha:'HOLD',battle:'HOLD'}
};
const invalid=()=>{throw new AppError(400,'INVALID_POLICY','정책의 필수값과 범위를 확인하세요.');};
const object=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))invalid();};
const bool=v=>{if(typeof v!=='boolean')invalid();};
const number=(v,min,max)=>{if(v!==null&&(!Number.isInteger(v)||v<min||v>max))invalid();};
export function validatePolicy(kind,v){
 if(!Object.hasOwn(policyDefaults,kind))invalid();object(v,Object.keys(policyDefaults[kind]));
 if(kind==='anemia'){
  bool(v.enabled);if(!Array.isArray(v.stages)||v.stages.length>100)invalid();
  for(const stage of v.stages){object(stage,['name','min','max','order']);if(typeof stage.name!=='string'||!stage.name.trim()||stage.name.length>50)invalid();
   for(const k of ['min','max'])if(!Number.isInteger(stage[k])||stage[k]<1||stage[k]>100)invalid();
   if(stage.min>stage.max||!Number.isInteger(stage.order)||stage.order<0||stage.order>2147483647)invalid();
  }
  if(v.enabled||v.stages.length){const sorted=[...v.stages].sort((a,b)=>a.min-b.min);let next=1;for(const s of sorted){if(s.min!==next)invalid();next=s.max+1;}if(next!==101)invalid();}
 }else if(kind==='donation'){
  bool(v.enabled);bool(v.dailyLimitEnabled);
  for(const k of ['cost','recovery','maximum'])number(v[k],1,100);
  number(v.minimumRemaining,0,100);number(v.dailyLimit,1,2147483647);
  if(v.enabled&&(['cost','recovery','maximum','minimumRemaining'].some(k=>v[k]===null)||(v.dailyLimitEnabled&&v.dailyLimit===null)))invalid();
  if(v.cost!==null&&v.maximum!==null&&v.cost>v.maximum)invalid();
  if(v.cost!==null&&v.minimumRemaining!==null&&v.cost+v.minimumRemaining>100)invalid();
 }else if(kind==='announcements'){
  object(v.events,eventNames.filter(name=>!['gacha','failure_food'].includes(name)||Object.hasOwn(v.events,name)));
  for(const [name,e] of Object.entries(v.events)){
   object(e,Object.keys(policyDefaults.announcements.events[name]));
   for(const k of ['enabled','deduplicate','retryEnabled'])bool(e[k]);
   if(typeof e.template!=='string'||e.template.length>2000)invalid();
   if(e.visibility!==null&&!['public','unlisted','private'].includes(e.visibility))invalid();
   number(e.maxAttempts,1,100);number(e.retryMinutes,1,10080);
   if(!Array.isArray(e.thresholds)||e.thresholds.length>100||e.thresholds.some(n=>!Number.isInteger(n)||n<1||n>100)||new Set(e.thresholds).size!==e.thresholds.length)invalid();
   if(name!=='investigation_progress'&&e.thresholds.length)invalid();
   if(e.enabled&&(!e.template.trim()||!e.visibility||(name==='investigation_progress'&&!e.thresholds.length)))invalid();
   if(e.retryEnabled&&(e.maxAttempts===null||e.retryMinutes===null))invalid();
   if(/\{(?!character\}|provider\}|reward\}|quantity\}|rp\}|area\}|monster\}|clue\}|progress\}|event\})/.test(e.template))invalid();
  }
 }else if(kind==='homepage'){
  for(const k of ['enabled','publicOnly','excludeReplies','excludeBoosts'])bool(v[k]);
  for(const k of ['accountId','noticeTag','eventTag'])if(v[k]!==null&&(typeof v[k]!=='string'||!v[k].trim()||v[k].length>100))invalid();
  number(v.limit,1,100);
  if(v.enabled&&['accountId','noticeTag','eventTag','limit'].some(k=>v[k]===null))invalid();
 }else if(Object.values(v).some(x=>!['HOLD','PREVIEW_ONLY'].includes(x)))invalid();
 return v;
}
export async function readPolicy(client,kind,lock=false){
 if(!Object.hasOwn(policyDefaults,kind))invalid();
 const row=(await client.query('select config_value from public.system_config where config_key=$1'+(lock?' for share':''),['operating_'+kind])).rows[0];
 if(!row)throw new AppError(503,'POLICY_NOT_CONFIGURED','운영 정책이 아직 설치되지 않았습니다.');
 return validatePolicy(kind,row.config_value);
}
export function createOperatingPolicyRepository(pool){return {
 async getAnemiaPolicy(){const row=(await pool.query("select config_value from public.system_config where config_key='operating_anemia'")).rows[0];if(!row)return {settings:null};return {settings:validatePolicy('anemia',row.config_value)};},
 async getOperatingPolicy(kind){return {settings:await readPolicy(pool,kind),executionReady:kind==='donation'};},
 async saveOperatingPolicy(actor,kind,body){
  object(body,['settings','before','requestKey']);const key=requestKey(body),settings=validatePolicy(kind,body.settings);
  return adminTransaction(pool,async c=>{
   await requireAdminRow(c,actor);await checkDuplicate(c,key);
   const row=(await c.query('select config_value,config_value=$2::jsonb as unchanged from public.system_config where config_key=$1 for update',['operating_'+kind,JSON.stringify(body.before)])).rows[0];
   if(!row)throw new AppError(503,'POLICY_NOT_CONFIGURED','운영 정책이 아직 설치되지 않았습니다.');
   if(!row.unchanged)throw new AppError(409,'POLICY_CHANGED','다른 관리자가 변경했습니다. 다시 조회하세요.');
   await c.query('update public.system_config set config_value=$2::jsonb where config_key=$1',['operating_'+kind,JSON.stringify(settings)]);
   await writeActionLog(c,{adminUserId:actor,category:'ADMIN',actionType:'OPERATING_POLICY_UPDATE',description:'운영 정책 변경',detail:{kind,before:row.config_value,after:settings},requestKey:key});
   return {settings,executionReady:kind==='donation'};
  });
 }
};}
