import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {AppError} from '../../shared/http.js';
import {readPolicy} from '../admin/operating-policy.js';

const instance='https://survival-bob.site';
const id=value=>typeof value==='string'&&/^[1-9][0-9]{0,29}$/.test(value);
const unavailable=()=>new AppError(503,'SYSTEM_FEED_UNAVAILABLE','시스템 계정 게시글을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.');
export function postText(html){
 return String(html||'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
  .replace(/<br\s*\/?\s*>|<\/p\s*>/gi,'\n').replace(/<[^>]*>/g,'')
  .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(all,key)=>{
   const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
   if(key[0]!=='#')return named[key.toLowerCase()]||all;
   const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
   return Number.isInteger(n)&&n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
  }).trim().slice(0,12000);
}
const tag=value=>String(value||'').replace(/^#/,'').normalize('NFC').toLowerCase();

export function createSystemFeedRepository(pool,{fetcher=fetch,now=Date.now,env={}}={}){
 const token=env.MASTODON_SYSTEM_ACCESS_TOKEN;
 const cache=new Map();let retryAt=0;
 async function json(path){
  if(now()<retryAt)throw unavailable();
  try{
   const response=await fetcher(instance+path,{redirect:'error',signal:AbortSignal.timeout(5000),headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}});
   if(!response.ok){if([401,403].includes(response.status))throw new AppError(503,'SYSTEM_FEED_AUTH_REQUIRED','시스템 계정의 게시글 조회 권한을 확인해야 합니다.');if(response.status===429)retryAt=now()+Math.max(60000,Math.min(3600000,(Number(response.headers.get('retry-after'))||60)*1000));throw unavailable();}
   const text=await response.text();if(text.length>1000000)throw unavailable();return JSON.parse(text);
  }catch(error){if(error instanceof AppError)throw error;throw unavailable();}
 }
 async function revisionFor(policy){
  const {rows}=await pool.query("select count(*)::text as count, max(sent_at)::text as latest from public.mastodon_event where status='SENT' and remote_status_id is not null");
  return createHash('sha256').update(JSON.stringify([policy,rows[0]?.count||'0',rows[0]?.latest||null])).digest('hex');
 }
 async function page(policy,before,revision){
  const key=JSON.stringify([policy,before,revision]),cached=cache.get(key);
  if(cached&&cached.until>now())return cached.promise;
  if(cache.size>=64)cache.delete(cache.keys().next().value);
  const promise=(async()=>{
   if(env.MASTODON_SYSTEM_ACCOUNT_ID&&env.MASTODON_SYSTEM_ACCOUNT_ID!==policy.accountId)throw unavailable();
   const account=await json(token?'/api/v1/accounts/verify_credentials':'/api/v1/accounts/'+policy.accountId);
   if(String(account.id)!==policy.accountId||account.username?.toLowerCase()!=='system'||account.acct?.toLowerCase()!=='system')throw unavailable();
   const query=new URLSearchParams({limit:'40',exclude_replies:String(policy.excludeReplies),exclude_reblogs:String(policy.excludeBoosts)});
   if(before)query.set('max_id',before);
   const rows=await json('/api/v1/accounts/'+policy.accountId+'/statuses?'+query);
   if(!Array.isArray(rows)||rows.length>40)throw unavailable();return rows;
  })();
  cache.set(key,{promise,until:now()+900000});
  try{return await promise;}catch(e){cache.delete(key);retryAt=Math.max(retryAt,now()+10000);throw e;}
 }
 return {async getSystemFeedConnection(){
  // The built-in anonymous key is public, never return a service or System token.
  const key=env.SUPABASE_ANON_KEY;
  try{if(typeof key!=='string'||JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role!=='anon')throw Error();}
  catch{throw new AppError(503,'SYSTEM_FEED_REALTIME_UNAVAILABLE','최근 기록 실시간 연결 설정을 확인하세요.');}
  return {url:'wss://grkohfxvafbquhmgnvwj.supabase.co/realtime/v1/websocket',key,table:'system_feed_signal'};
 },async getSystemFeedRevision(){
  const policy=await readPolicy(pool,'homepage');
  return {enabled:policy.enabled,revision:await revisionFor(policy)};
 },async getSystemFeed(kind='activity',before=null,{includeFollowers=false}={}){
  if(!['activity','notice','event'].includes(kind)||(before!==null&&!id(before)))throw new AppError(400,'INVALID_FEED_QUERY','게시글 조회 조건을 확인하세요.');
  if(kind!=='activity')return {enabled:false,records:[],nextBefore:null};
  const policy=await readPolicy(pool,'homepage');
  if(!policy.enabled||(kind==='notice'&&!policy.noticeTag)||(kind==='event'&&!policy.eventTag))return {enabled:false,records:[],nextBefore:null};
  if(!id(policy.accountId))throw new AppError(503,'SYSTEM_FEED_NOT_CONFIGURED','시스템 계정 설정을 확인하세요.');
  // Only the session-protected recent-activity route opts into followers-only posts.
  const runnerActivity=kind==='activity'&&includeFollowers;
  const revision=await revisionFor(policy);
  const rows=await page(policy,before,revision),records=[];
  for(const row of rows){
   if(!row||typeof row!=='object'||!id(row.id)||(before&&BigInt(row.id)>=BigInt(before))||String(row.account?.id)!==policy.accountId)continue;
   if(policy.excludeReplies&&row.in_reply_to_id!=null||policy.excludeBoosts&&row.reblog)continue;
   const post=row.reblog||row;
   const allowed=runnerActivity&&!row.reblog?['public','unlisted','private']:['public','unlisted'];
   if(![row.visibility,post.visibility].every(v=>allowed.includes(v)))continue;
   if(!runnerActivity&&policy.publicOnly&&(row.visibility!=='public'||post.visibility!=='public'))continue;
   if(kind!=='activity'&&!(Array.isArray(post.tags)?post.tags:[]).some(t=>tag(t.name)===tag(policy[kind==='notice'?'noticeTag':'eventTag'])))continue;
   if(!Number.isFinite(Date.parse(row.created_at)))continue;
   records.push({id:row.id,text:postText(post.content),warning:postText(post.spoiler_text),createdAt:row.created_at,url:instance+'/@System/'+row.id,boosted:!!row.reblog});
  }
  const limit=Math.min(40,policy.limit),visible=records.slice(0,limit);
  const last=rows.at(-1)?.id;
  const next=records.length>limit?visible.at(-1)?.id:rows.length===40&&id(last)?last:null;
  return {enabled:true,revision,records:visible,nextBefore:next&&(!before||BigInt(next)<BigInt(before))?next:null};
 }};
}
