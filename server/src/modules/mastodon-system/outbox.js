import {createHash,randomUUID} from 'node:crypto';

export const events=['death','revive','area_unlock','monster_discovery','clue_discovery','recipe_discovery','gacha','failure_food','investigation_progress','dice'];
export const templateVariables={recipe_discovery:['character','recipe'],death:['character'],revive:['character','provider'],area_unlock:['area'],monster_discovery:['character','area','monster'],clue_discovery:['character','clue'],gacha:['character','reward','quantity'],failure_food:['character','rp'],investigation_progress:['character','area','progress'],dice:['character','result']};
const safeText=value=>value.replace(/<[^>]*>/g,'').replace(/@/g,'＠').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'');
const defaults={recipe_discovery:'{character} · 「{recipe}」 레시피 최초 발견',investigation_progress:'{area} 조사율 {progress}% 달성 · {character}',dice:'{character}의 결과는 {result}입니다.',death:'{character} 사망',revive:'{provider}님이 {character}님을 부활시켰습니다.',area_unlock:'{area} 개방',monster_discovery:'{character} · {area}에서 {monster} 전역 최초 발견',clue_discovery:'{character} · {clue} 전역 최초 발견',gacha:'【보급품 뽑기】\n{character}님이 보급품 상자를 개봉했습니다.\n획득한 물품: 「{reward}」 ×{quantity}',failure_food:'{character} · {rp}'};
export function messageFor(type,values,template=defaults[type]) {
  if(!events.includes(type)||typeof template!=='string'||!template.trim())throw Error('INVALID_POST_EVENT');
  const message=template.replace(/\{([^{}]+)\}/g,(_,key)=>{
    if(!templateVariables[type].includes(key)||typeof values[key]!=='string'||!values[key].trim())throw Error('INVALID_POST_VALUES');
    return safeText(values[key]);
  });
  if(/[{}]/.test(message)||Array.from(message).length>500)throw Error('INVALID_POST_LENGTH');
  return safeText(message);
}

export const systemPostKey=(type,key)=>createHash('sha256').update(type+':'+key).digest('hex');
const committedPosts=new WeakMap();
export function discardSystemPostWakeups(client){committedPosts.delete(client);}
export function flushSystemPostWakeups(client){
 const keys=committedPosts.get(client);committedPosts.delete(client);
 if(keys?.size)try{client.wakeSystemPosts?.([...keys]);}catch{/* A wakeup failure must not change a committed game result. Cron recovers the queue. */}
}

// Must receive the caller's game transaction, never a separate pool connection.
// Disabled/unconfigured policies create no events. Snapshot text and visibility.
export async function enqueueSystemEvent(client,{type,key,characterId=null,targetType=null,targetId=null,values}) {
  if(!events.includes(type)||typeof key!=='string'||!key)throw Error('INVALID_POST_EVENT');
  const {rows}=await client.query("select config_value from public.system_config where config_key='operating_announcements'");
  const policy=rows[0]?.config_value?.events?.[type];
  if(!policy?.enabled)return false;
  if(!['public','unlisted','private'].includes(policy.visibility))throw Error('INVALID_POST_VISIBILITY');
  const message=messageFor(type,values,policy.template||undefined);
  const retry=policy.retryEnabled===true;
  if(retry&&(!Number.isInteger(policy.maxAttempts)||policy.maxAttempts<1||!Number.isInteger(policy.retryMinutes)||policy.retryMinutes<1))throw Error('INVALID_POST_RETRY');
  const dedupe=systemPostKey(type,key);
  const inserted=await client.query(`insert into public.mastodon_event(event_type,character_id,message,dedupe_key,visibility,delivery_enabled,auto_retry,max_attempts,retry_delay_seconds,target_type,target_id)
    values($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10) on conflict(dedupe_key) do nothing returning dedupe_key`,
    [type,characterId,message,dedupe,policy.visibility,retry,retry?Math.min(3,policy.maxAttempts):1,retry?Math.min(604800,Math.max(300,policy.retryMinutes*60)):300,targetType,targetId]);
  if(inserted.rowCount&&typeof client.wakeSystemPosts==='function'){
   if(!committedPosts.has(client))committedPosts.set(client,new Set());
   committedPosts.get(client).add(dedupe);
  }
  return true;
}

export function createSystemOutbox(pool,{dedupeKey=null}={}) {
  return {
    async claim(){
      const c=await pool.connect();
      try{
        await c.query('begin');
        const lock=await c.query('select pg_try_advisory_xact_lock(184275,910) as locked');
        if(!lock.rows[0].locked){await c.query('commit');return null;}
        // A crashed sender may already have published. Never automatically resend it.
        await c.query(`update public.mastodon_event set status='FAILED',delivery_enabled=false,last_error='DELIVERY_UNCERTAIN',lease_token=null,lease_until=null
          where lease_until<clock_timestamp() and lease_token is not null`);
        const paused=await c.query("select 1 from public.mastodon_event where last_error='RATE_LIMITED' and next_attempt_at>clock_timestamp() limit 1");
        if(paused.rowCount){await c.query('commit');return null;}
        const recent=await c.query("select 1 from public.mastodon_event where attempt_at>clock_timestamp()-interval '5 seconds' limit 1");
        if(recent.rowCount){await c.query('commit');return null;}
        const result=await c.query(`select * from public.mastodon_event where delivery_enabled and status in ('PENDING','FAILED')
          and exists(select 1 from public.system_config policy where policy.config_key='operating_announcements'
            and policy.config_value->'events'->mastodon_event.event_type->>'enabled'='true')
          and ($1::text is null or dedupe_key=$1)
          and retry_count<max_attempts and lease_token is null and (next_attempt_at is null or next_attempt_at<=clock_timestamp())
          order by created_at,id for update skip locked limit 1`,[dedupeKey]);
        const row=result.rows[0];
        if(row){row.lease_token=randomUUID();await c.query(`update public.mastodon_event set lease_token=$2,lease_until=clock_timestamp()+interval '60 seconds',
          attempt_at=clock_timestamp(),retry_count=retry_count+1 where id=$1`,[row.id,row.lease_token]);}
        await c.query('commit');return row||null;
      }catch(error){await c.query('rollback');throw error;}finally{c.release();}
    },
    async finish(row,{remoteId=null,error=null,retry=false,delay=300}){
      const result=await pool.query(`update public.mastodon_event set status=$3::varchar,remote_status_id=$4,last_error=$5,
        delivery_enabled=($6 and auto_retry and retry_count<max_attempts),sent_at=case when $3='SENT' then clock_timestamp() else sent_at end,
        next_attempt_at=clock_timestamp()+(greatest($7::integer,retry_delay_seconds)*interval '1 second'),lease_token=null,lease_until=null
        where id=$1 and lease_token=$2`,[row.id,row.lease_token,remoteId?'SENT':'FAILED',remoteId,error,retry,delay]);
      if(result.rowCount!==1)throw Error('POST_LEASE_LOST');
    }
  };
}
