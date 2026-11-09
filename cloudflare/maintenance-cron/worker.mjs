export const MIDNIGHT='0 15 * * *', RETRY='*/30 * * * *';
const BASE='https://grkohfxvafbquhmgnvwj.supabase.co/functions/v1/maintenance';
const codes=new Set(['MAINTENANCE_CONCURRENCY_HOLD','DAILY_RESET_START_HOLD','DAILY_RESET_ACTIVITY_HOLD','MAINTENANCE_PARTIAL_FAILURE','MAINTENANCE_UNAUTHORIZED','MAINTENANCE_BROWSER_DENIED']);
export const kstDate=t=>new Date(t+9*3600000).toISOString().slice(0,10);
export async function runScheduled(event,env,{fetcher=fetch,log=e=>console.log(JSON.stringify(e)),timeoutMs=120000}={}) {
 const operations=event.cron===MIDNIGHT?['daily-reset']:event.cron===RETRY?['daily-reset','battle-expiry']:[];
 // Edge's DB lock decides date completion; no local cache or immediate retry after uncertain commits.
 return Promise.all(operations.map(async operation=>{
  const started=Date.now(),entry={operation,scheduledAt:new Date(event.scheduledTime).toISOString(),kstDate:kstDate(event.scheduledTime)};
  const controller=new AbortController();let timer;
  function finish(status){if(entry.status)return {...entry};entry.status=status;entry.durationMs=Date.now()-started;log({...entry});return {...entry};}
  try {
   if(typeof env.MAINTENANCE_SECRET!=='string'||env.MAINTENANCE_SECRET.length<32)return finish('CONFIG_ERROR');
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},timeoutMs);});
   const work=(async()=>{
    const response=await fetcher(`${BASE}/${operation}`,{method:'POST',redirect:'manual',signal:controller.signal,headers:{'x-maintenance-secret':env.MAINTENANCE_SECRET,'Content-Type':'application/json'},body:'{}'});
    let body;try{body=await response.json();}catch{return finish('INVALID_RESPONSE');}
    if(entry.status)return {...entry};
    entry.httpStatus=response.status;
    if(codes.has(body?.error?.code))entry.code=body.error.code;
    const value=body?.data?.result||body?.data;
    for(const k of ['attempted','expired','skipped','failed','deferred'])if(Number.isSafeInteger(value?.[k])&&value[k]>=0)entry[k]=value[k];
    if(body?.data?.reset?.hold||entry.code?.endsWith('_HOLD'))return finish('HOLD');
    if(entry.code==='MAINTENANCE_PARTIAL_FAILURE'||entry.failed>0||entry.deferred>0)return finish('PARTIAL_FAILURE');
    if(!response.ok||body?.ok!==true)return finish('FAILED');
    if(operation==='daily-reset'){
     if(!Array.isArray(body.data?.reset?.completed))return finish('INVALID_RESPONSE');
     entry.completedDays=body.data.reset.completed.length;return finish(entry.completedDays?'OK':'SKIPPED');
    }
    if(!Number.isSafeInteger(body.data?.expired)||body.data.expired<0)return finish('INVALID_RESPONSE');
    return finish('OK');
   })();
   return await Promise.race([work,timeout]);
  }catch{return finish(controller.signal.aborted?'TIMEOUT':'NETWORK_ERROR');}finally{clearTimeout(timer);}
 }));
}
export default {fetch(){return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});},async scheduled(event,env){await runScheduled(event,env);}};
