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

test('OAuth-only deployment allows exact auth routes, retains all game and proxy guards',async t=>{
 const runtime=createVerificationApi({...env,MASTODON_CLIENT_ID:'fixture',MASTODON_CLIENT_SECRET:'fixture'}, {oauthEnabled:true,poolFactory:()=>({query(){throw Error('unexpected SQL');}})});
 let stateWrites=0,revokes=0;runtime.repository.saveOAuthState=async()=>{stateWrites++;};
 runtime.repository.getOAuthSession=async()=>({id:1,role:'USER',character_id:null});
 runtime.repository.revokeOAuthSession=async()=>{revokes++;};
 runtime.repository.consumeOAuthState=async()=>false;
 const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`,headers={'x-sangjonbap-proxy':env.EDGE_PROXY_SECRET,Origin:env.FRONTEND_ORIGIN};
 const call=(path,opts={})=>fetch(base+path,{redirect:'manual',headers,...opts});
 assert.equal((await call('/api/auth/config')).status,200);
 assert.equal((await call('/api/auth/me')).status,401);
 const login=await call('/api/auth/mastodon/login');assert.equal(login.status,302);assert.equal(stateWrites,1);assert.equal(new URL(login.headers.get('location')).searchParams.get('code_challenge_method'),'S256');
 const callback=await call('/api/auth/mastodon/callback?state=bad&code=private');assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'https://survivalbob.site/#oauth_error=OAUTH_STATE_INVALID');
 const cookie='__Host-sangjonbap-session='+'b'.repeat(64);
 assert.equal((await call('/api/auth/me',{headers:{...headers,Cookie:cookie}})).status,200);
 assert.equal((await call('/api/auth/logout',{method:'POST',headers:{...headers,Cookie:cookie}})).status,200);assert.equal(revokes,1);
 assert.equal((await call('/api/auth/logout',{method:'POST',headers:{'x-sangjonbap-proxy':env.EDGE_PROXY_SECRET,Cookie:cookie}})).status,403);
 for(const path of ['/api/shop/products','/api/admin/items','/api/auth/dev/login','/api/auth/config/','/api/auth/%63onfig'])for(const method of ['GET','POST'])assert.equal((await call(path,{method})).status,401,path);
 assert.equal((await call('/api/auth/config',{headers:{Origin:env.FRONTEND_ORIGIN}})).status,403);
 assert.equal((await call('/api/auth/config',{headers:{...headers,Origin:'https://lumia-sh.github.io'}})).status,403);
 assert.equal((await call('/api/admin/items',{method:'POST',headers:{...headers,'x-edge-verification-key':env.EDGE_VERIFICATION_TOKEN}})).status,403);
});

test('OAuth admin namespace requires server role, protects writes and never opens game routes',async t=>{
 const runtime=createVerificationApi({...env,MASTODON_CLIENT_ID:'fixture',MASTODON_CLIENT_SECRET:'fixture'}, {oauthEnabled:true,adminEnabled:true,poolFactory:()=>({query(){throw Error('Unexpected SQL');}})});
 let role='USER',writes=0,resets=0;runtime.repository.getOAuthSession=async()=>({id:'306',role,is_active:true});runtime.repository.recoverDailyReset=async()=>{resets++;throw Error('Must not reset');};
 runtime.repository.searchAdminUsers=async()=>[];
 runtime.repository.changeAdminRole=async()=>{writes++;return {settings:{enabled:false}};};
 const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`,headers={'x-sangjonbap-proxy':env.EDGE_PROXY_SECRET,Origin:env.FRONTEND_ORIGIN,Cookie:'__Host-sangjonbap-session='+'b'.repeat(64)};
 const call=(path,options={})=>fetch(base+path,{headers,...options});
 assert.equal((await call('/api/admin/access',{headers:{'x-sangjonbap-proxy':env.EDGE_PROXY_SECRET}})).status,401);
 assert.equal((await call('/api/admin/access')).status,403);
 role='ADMIN';const access=await call('/api/admin/access');assert.equal(access.status,200);assert.equal((await access.json()).data.authentication,'MASTODON');
 assert.equal((await call('/api/admin/users')).status,200);
 const patch={method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({role:'ADMIN',requestKey:'12345678-1234-4234-8234-123456789012'})};
 assert.equal((await call('/api/admin/users/2/role',patch)).status,200);assert.equal(writes,1);
 assert.equal((await call('/api/admin/users/2/role',{...patch,headers:{...patch.headers,Origin:'https://evil.invalid'}})).status,403);
 const noOrigin={...patch.headers};delete noOrigin.Origin;assert.equal((await call('/api/admin/users/2/role',{...patch,headers:noOrigin})).status,403);
 role='USER';assert.equal((await call('/api/admin/users/2/role',patch)).status,403);assert.equal(writes,1);
 role='ADMIN';for(const path of ['/api/shop/products','/api/battles/1/commands','/api/admin-other','/api/%61dmin/access'])assert.equal((await call(path)).status,401);
 assert.equal((await call('/api/shop/1/purchase',{...patch,method:'POST'})).status,401);
 assert.equal((await call('/api/admin/access',{headers:{Origin:env.FRONTEND_ORIGIN,Cookie:headers.Cookie}})).status,403);
 assert.equal((await call('/api/admin/access',{headers:{...headers,Origin:'https://lumia-sh.github.io'}})).status,403);
 const options=await call('/api/admin/users/2/role',{method:'OPTIONS'});assert.equal(options.status,204);assert.ok(options.headers.get('access-control-allow-methods').includes('PATCH'));assert.equal(resets,0);
});

test('limited game testing opens published reads and only active OAuth admins or participants',async t=>{
 const runtime=createVerificationApi({...env,MASTODON_CLIENT_ID:'fixture',MASTODON_CLIENT_SECRET:'fixture'},{oauthEnabled:true,adminEnabled:true,gameTestingEnabled:true,poolFactory:()=>({query(){throw Error('Unexpected SQL');}})});
 let user={id:'306',role:'ADMIN',is_active:true,character_id:'9',game_test_enabled:false},writes=0,resets=0;
 runtime.repository.getOAuthSession=async()=>user;
 runtime.repository.getPublicContent=async()=>({content:null});
 runtime.repository.getAnemiaPolicy=async()=>({settings:null});
 runtime.repository.recoverDailyReset=async()=>{resets++;return {hold:true};};
 runtime.repository.getCharacter=async id=>{assert.equal(id,user.id);return {id:user.character_id,hp:100};};
 runtime.repository.trainCharacter=async id=>{assert.equal(id,user.id);writes++;return {trained:true};};
 const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const proxy={'x-sangjonbap-proxy':env.EDGE_PROXY_SECRET,Origin:env.FRONTEND_ORIGIN};
 const headers={...proxy,Cookie:'__Host-sangjonbap-session='+'b'.repeat(64),'Content-Type':'application/json'};
 const call=(path,options={})=>fetch(base+path,{headers,...options});
 assert.equal((await call('/api/public/guides/world',{headers:proxy})).status,200);assert.equal(resets,0);
 assert.equal((await call('/api/characters/me',{headers:proxy})).status,401);
 assert.equal((await call('/api/characters/me')).status,200);
 const post={method:'POST',body:JSON.stringify({requestKey:'12345678-1234-4234-8234-123456789012'})};
 assert.equal((await call('/api/training',post)).status,200);assert.equal(writes,1);
 user={...user,id:'2',role:'USER'};
 const denied=await call('/api/characters/me');assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,'GAME_TEST_ACCESS_REQUIRED');
 const before=resets;assert.equal((await call('/api/training',post)).status,403);assert.equal(resets,before);
 user.game_test_enabled=true;assert.equal((await call('/api/training',post)).status,200);assert.equal(writes,2);
 assert.equal((await call('/api/admin/access')).status,403);
 assert.equal((await call('/api/characters/999/profile',{method:'PATCH',body:'{}'})).status,404);
 assert.equal((await call('/api/training',{...post,headers:{...headers,Origin:'https://evil.invalid'}})).status,403);
 const noOrigin={...headers};delete noOrigin.Origin;assert.equal((await call('/api/training',{...post,headers:noOrigin})).status,403);
 user.game_test_enabled=false;assert.equal((await call('/api/training',post)).status,403);
 user=null;assert.equal((await call('/api/characters/me')).status,401);
 assert.equal((await call('/api/public/guides/world',{headers:{}})).status,403);
 const preflight=await call('/api/training',{method:'OPTIONS',headers:proxy});assert.equal(preflight.status,204);assert.ok(preflight.headers.get('access-control-allow-methods').includes('POST'));
 assert.equal((await call('/api/dev/action-logs')).status,401);assert.equal(writes,2);
});
