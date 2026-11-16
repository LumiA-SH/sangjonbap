import {createHash} from 'node:crypto';
import {enqueueSystemEvent,createSystemOutbox,flushSystemPostWakeups,discardSystemPostWakeups} from './outbox.js';
import {sendSystemPost} from './sender.js';

// Called inside the investigation's existing area-locked transaction.
export async function enqueueProgressEvents(client,area,character,before,after){
 if(after<=before)return;
 const row=(await client.query("select config_value from public.system_config where config_key='operating_announcements'")).rows[0];
 const policy=row?.config_value?.events?.investigation_progress;
 if(!policy?.enabled)return;
 for(const threshold of policy.thresholds||[]){
  if(Number.isInteger(threshold)&&threshold>=1&&threshold<=100&&before<threshold&&after>=threshold)
   await enqueueSystemEvent(client,{type:'investigation_progress',key:`${area.id}:${threshold}`,characterId:character.id,values:{character:character.name,area:area.name,progress:String(threshold)}});
 }
}

// Time-based visibility uses the exact same conditions as the investigation catalogue.
export async function enqueueOpenAreas(pool){
 const c=await pool.connect();
 try{
  await c.query('begin');
  const policy=(await c.query("select config_value from public.system_config where config_key='operating_announcements'")).rows[0];
  if(!policy?.config_value?.events?.area_unlock?.enabled){await c.query('commit');return 0;}
  const rows=(await c.query(`select a.id,a.name from public.area a where (a.is_open or a.auto_unlock)
   and (a.unlock_at is null or a.unlock_at<=clock_timestamp())
   and not exists(select 1 from public.mastodon_event e where e.event_type='area_unlock' and e.target_type='AREA' and e.target_id=a.id)
   order by a.id limit 20 for update of a skip locked`)).rows;
  for(const area of rows)await enqueueSystemEvent(c,{type:'area_unlock',key:String(area.id),targetType:'AREA',targetId:area.id,values:{area:area.name}});
  await c.query('commit');flushSystemPostWakeups(c);return rows.length;
 }catch(error){await c.query('rollback');discardSystemPostWakeups(c);throw error;}finally{c.release();}
}

// A bounded sequential batch; DB claims still enforce spacing across all workers.
export async function runSystemPostBatch(send,{sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>performance.now()}={}){
 const started=now();let sent=0,attempted=0;
 for(let i=0;i<5;i++){
  // Reserve up to 20 seconds for account verification and a POST before stopping.
  if(i>0){if(now()-started+5100>=35000)break;await sleep(5100);if(now()-started>=35000)break;}
  const result=await send();
  if(result.state==='SENT'){sent++;attempted++;continue;}
  if(result.state==='FAILED')return {...result,sent,attempted:attempted+1,failed:1};
  if(result.state==='HOLD')return {...result,sent,attempted};
  return {state:sent?'SENT':'IDLE',sent,attempted};
 }
 return {state:sent?'SENT':'IDLE',sent,attempted};
}

// Neither API requests nor app startup call this function.
export function createSystemPostJob(pool,env,{fetcher=fetch}={}){
 const outbox=createSystemOutbox(pool);
 return async()=>{
  if(env.MASTODON_SYSTEM_POSTING_ENABLED!=='true')return {state:'HOLD'};
  if(!env.MASTODON_SYSTEM_ACCESS_TOKEN?.trim()||!/^\d+$/.test(env.MASTODON_SYSTEM_ACCOUNT_ID||''))throw Error('SYSTEM_POST_SETTINGS_REQUIRED');
  await enqueueOpenAreas(pool);
  return runSystemPostBatch(()=>sendSystemPost(outbox,env,{fetcher}));
 };
}


// Wake only an already committed outbox event. Cron remains the recovery path.
export function createEventPostJob(pool,env,{send=sendSystemPost,fetcher=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 return async key=>{
  if(env.MASTODON_SYSTEM_POSTING_ENABLED!=='true')return {state:'HOLD'};
  const outbox=createSystemOutbox(pool,{dedupeKey:key});
  for(let attempt=0;attempt<5;attempt++){
   const row=(await pool.query("select status,delivery_enabled,lease_token from public.mastodon_event where dedupe_key=$1",[key])).rows[0];
   if(!row||row.status!=='PENDING'||!row.delivery_enabled||row.lease_token)return {state:'IDLE'};
   const result=await send(outbox,env,{fetcher});
   // Do not retry POST failures or uncertain delivery. Only wait for the existing claim throttle.
   if(result.state!=='IDLE')return result;
   if(attempt<4)await sleep(5100);
  }
  return {state:'IDLE'};
 };
}

export function createDicePostWakeup(send,waitUntil){
 const running=new Map();
 return requestKey=>{
  if(typeof waitUntil!=='function'||running.has(requestKey))return;
  const task=Promise.resolve().then(()=>send(requestKey)).catch(()=>({state:'FAILED'})).finally(()=>running.delete(requestKey));
  running.set(requestKey,task);
  try{waitUntil(task);}catch{/* The durable queue remains available to Cron. */}
 };
}


export function createDicePostJob(pool,env,options){
 const send=createEventPostJob(pool,env,options);
 return requestKey=>send(createHash('sha256').update('dice:'+requestKey).digest('hex'));
}

export function withSystemPostWakeup(pool,wake){
 return {query:(...args)=>pool.query(...args),async connect(){
  const client=await pool.connect();
  return {query:(...args)=>client.query(...args),release:()=>client.release(),wakeSystemPosts:wake};
 }};
}
