import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerificationApi} from './verification.js';
const env = {EDGE_PROJECT_REF:'grkohfxvafbquhmgnvwj',FRONTEND_ORIGIN:'https://survivalbob.site',
    PUBLIC_API_BASE_URL:'https://grkohfxvafbquhmgnvwj.supabase.co/functions/v1/api',
    EDGE_DATABASE_URL:'postgresql://postgres.grkohfxvafbquhmgnvwj:fixture@fixture.pooler.supabase.com:6543/postgres',
    EDGE_PROXY_SECRET:'p'.repeat(64),EDGE_VERIFICATION_TOKEN:'a'.repeat(64)};

test('verification guard isolates all gameplay, preserves auth and uses read-only DB transaction', async t => {
    const queries=[];
    const client={query:async sql=>{queries.push(sql);return {rows:[{read_only:'on',character_table:true,action_log_table:true,reset_start_unset:true}]};},release(){queries.push('release');}};
    const runtime=createVerificationApi(env,{poolFactory:()=>({connect:async()=>client,query:()=>{throw new Error('Unexpected database access');}})});
    const server=runtime.app.listen(0,'127.0.0.1');
    await new Promise(r=>server.once('listening',r));
    t.after(()=>new Promise(r=>server.close(r)));
    const base=`http://127.0.0.1:${server.address().port}`;
    const key={'x-edge-verification-key':env.EDGE_VERIFICATION_TOKEN,'x-sangjonbap-proxy':env.EDGE_PROXY_SECRET};
    async function check(path,status,options={}) {const r=await fetch(base+path,options);assert.equal(r.status,status,path);return r;}
    await check('/api/health',403);
    await check('/api/health',401,{headers:{'x-sangjonbap-proxy':env.EDGE_PROXY_SECRET}});
    await check('/api/health',200,{headers:key});
    for(const method of ['POST','PATCH','PUT','DELETE','HEAD'])
        for(const path of ['/api/shop/1/purchase','/api/admin/items','/api/battles/1/commands'])
            await check(path,403,{method,headers:key});
    for(const path of ['/api/auth/mastodon/login','/api/auth/mastodon/callback','/api/battles/current','/api/admin/items','/api/cooking/catalog'])
        await check(path,403,{headers:key});
    await check('/api/characters/me',401,{headers:key});
    let authCalls=0;
    runtime.repository.getOAuthSession=async()=>{authCalls++;return {id:1,is_active:true};};
    await check('/api/characters/me',403,{headers:{...key,Cookie:'__Host-sangjonbap-session='+'b'.repeat(64)}});
    assert.equal(authCalls,1);
    const cors=await check('/api/health',200,{headers:{...key,Origin:env.FRONTEND_ORIGIN}});
    assert.equal(cors.headers.get('access-control-allow-origin'),env.FRONTEND_ORIGIN);
    assert.equal(cors.headers.get('access-control-allow-credentials'),'true');
    await check('/api/health',403,{headers:{...key,Origin:'https://evil.example'}});
    await check('/api/health',204,{method:'OPTIONS',headers:{'x-sangjonbap-proxy':env.EDGE_PROXY_SECRET,Origin:env.FRONTEND_ORIGIN,'Access-Control-Request-Method':'GET'}});
    assert.equal(queries.length,0);
    const db=await check('/api/compat/db',200,{headers:key});
    assert.equal((await db.json()).data.read_only,'on');
    assert.equal(queries[0],'BEGIN READ ONLY');assert.equal(queries.at(-2),'ROLLBACK');assert.equal(queries.at(-1),'release');
});
test('missing verification key fails closed before creating app',()=>assert.throws(()=>createVerificationApi({...env,EDGE_VERIFICATION_TOKEN:''})));
test('optional Pages CORS supports error inspection without bypassing either guard',async t=>{
    const origin='https://lumia-sh.github.io';
    const runtime=createVerificationApi({...env,VERIFICATION_FRONTEND_ORIGIN:origin},{poolFactory:()=>({query(){throw new Error('DB forbidden');}})});
    const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
    const url=`http://127.0.0.1:${server.address().port}/api/auth/config`;
    const headers={Origin:origin,'x-sangjonbap-proxy':env.EDGE_PROXY_SECRET};
    const r=await fetch(url,{headers});assert.equal(r.status,401);assert.equal(r.headers.get('access-control-allow-origin'),origin);
    assert.equal((await r.json()).error.code,'VERIFICATION_KEY_REQUIRED');
    assert.equal((await fetch(url,{method:'OPTIONS',headers:{...headers,'Access-Control-Request-Method':'GET'}})).status,204);
    assert.equal((await fetch(url,{headers:{Origin:origin}})).status,403);
    assert.equal((await fetch(url,{headers:{...headers,'x-sangjonbap-proxy':'wrong'}})).status,403);
    assert.equal((await fetch(url,{headers:{...headers,'x-edge-verification-key':env.EDGE_VERIFICATION_TOKEN}})).status,403);
    assert.equal((await fetch(url,{method:'POST',headers:{...headers,'x-edge-verification-key':env.EDGE_VERIFICATION_TOKEN}})).status,403);
});


test('proxy and Edge guards compose without executing gameplay', async t => {
    const {proxy}=await import('../../../cloudflare/api-proxy/worker.mjs');
    const runtime=createVerificationApi(env,{poolFactory:()=>({connect(){throw new Error('Forbidden DB access');},query(){throw new Error('Forbidden DB access');}})});
    const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
    const relay=(url,opts)=>fetch(`http://127.0.0.1:${server.address().port}`+new URL(url).pathname.replace('/functions/v1',''),{...opts,...(opts.body?{duplex:'half'}:{})});
    const base='https://api.survivalbob.site/functions/v1/api';
    assert.equal((await proxy(new Request(base+'/health'),env,relay)).status,401);
    const headers={'x-edge-verification-key':env.EDGE_VERIFICATION_TOKEN,'x-sangjonbap-proxy':'spoof'};
    assert.equal((await proxy(new Request(base+'/health',{headers}),env,relay)).status,200);
    assert.equal((await proxy(new Request(base+'/admin/items',{method:'POST',headers,body:'{}'}),env,relay)).status,403);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/health`,{headers:{'x-edge-verification-key':env.EDGE_VERIFICATION_TOKEN}})).status,403);
});
