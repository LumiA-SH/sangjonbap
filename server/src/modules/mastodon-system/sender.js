const instance='https://survival-bob.site';
// No environment file loading, logging, or frontend imports. Separate System token only.
export async function sendSystemPost(outbox,env,{fetcher=fetch}={}) {
  if(env.MASTODON_SYSTEM_POSTING_ENABLED!=='true')return {state:'HOLD'};
  const token=env.MASTODON_SYSTEM_ACCESS_TOKEN,accountId=env.MASTODON_SYSTEM_ACCOUNT_ID;
  if(typeof token!=='string'||!token.trim()||!/^\d+$/.test(accountId||''))throw Error('SYSTEM_POST_SETTINGS_REQUIRED');
  // Refuse to post from a login user's token or an unexpected account.
  let account;
  try{
    const r=await fetcher(instance+'/api/v1/accounts/verify_credentials',{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(r.ok)account=await r.json();
  }catch{}
  if(String(account?.id)!==accountId||account?.username?.toLowerCase()!=='system')throw Error('SYSTEM_ACCOUNT_UNVERIFIED');
  const row=await outbox.claim();if(!row)return {state:'IDLE'};
  let response;
  try{
    response=await fetcher(instance+'/api/v1/statuses',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':row.dedupe_key},
      body:JSON.stringify({status:row.message,visibility:row.visibility})});
  }catch{
    await outbox.finish(row,{error:'DELIVERY_UNCERTAIN'});return {state:'FAILED',reason:'DELIVERY_UNCERTAIN'};
  }
  if(response.status===429){
    const header=response.headers.get('retry-after');const seconds=Number(header);
    const delay=header&&Number.isFinite(seconds)?Math.max(300,Math.min(86400,Math.ceil(seconds))):86400;
    await outbox.finish(row,{error:'RATE_LIMITED',retry:true,delay});return {state:'FAILED',reason:'RATE_LIMITED'};
  }
  if(!response.ok){
    // 5xx can be an acknowledgement loss: manual reconciliation, not blind retry.
    const reason=response.status>=500?'DELIVERY_UNCERTAIN':'POST_REJECTED';
    await outbox.finish(row,{error:reason});return {state:'FAILED',reason};
  }
  let body;try{body=await response.json();}catch{}
  if(typeof body?.id!=='string'||!/^\d+$/.test(body.id)){
    await outbox.finish(row,{error:'DELIVERY_UNCERTAIN'});return {state:'FAILED',reason:'DELIVERY_UNCERTAIN'};
  }
  await outbox.finish(row,{remoteId:body.id});return {state:'SENT'};
}
