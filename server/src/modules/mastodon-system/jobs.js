import {enqueueSystemEvent,createSystemOutbox} from './outbox.js';
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
  const rows=(await c.query(`select a.id,a.name from public.area a where a.is_open
   and (a.unlock_at is null or a.unlock_at<=clock_timestamp())
   and not exists(select 1 from public.mastodon_event e where e.event_type='area_unlock' and e.target_type='AREA' and e.target_id=a.id)
   order by a.id limit 20 for update of a skip locked`)).rows;
  for(const area of rows)await enqueueSystemEvent(c,{type:'area_unlock',key:String(area.id),targetType:'AREA',targetId:area.id,values:{area:area.name}});
  await c.query('commit');return rows.length;
 }catch(error){await c.query('rollback');throw error;}finally{c.release();}
}

// One bounded delivery per tick; the outbox enforces a global five-second spacing.
// Neither API requests nor app startup call this function.
export function createSystemPostJob(pool,env,{fetcher=fetch}={}){
 const outbox=createSystemOutbox(pool);
 return async()=>{
  if(env.MASTODON_SYSTEM_POSTING_ENABLED!=='true')return {state:'HOLD'};
  if(!env.MASTODON_SYSTEM_ACCESS_TOKEN?.trim()||!/^\d+$/.test(env.MASTODON_SYSTEM_ACCOUNT_ID||''))throw Error('SYSTEM_POST_SETTINGS_REQUIRED');
  await enqueueOpenAreas(pool);
  return sendSystemPost(outbox,env,{fetcher});
 };
}
