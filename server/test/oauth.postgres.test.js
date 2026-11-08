import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool as createPool} from './isolated-pool.js';
import {createOAuthRepository} from '../src/modules/auth/oauth-repository.js';
import {digest} from '../src/modules/auth/oauth-session.js';
import {createApp} from '../src/app.js';
import {loadEdgeConfig} from '../src/config/edge.js';

test('OAuth shared PostgreSQL state, identity and sessions (isolated)',{skip:process.env.RUN_OAUTH_DB_TESTS!=='1'},async t=>{
    const raw=createPool(),schema='test_oauth_'+randomUUID().replaceAll('-','');
    const rewrite=q=>q.replaceAll('public.',schema+'.');
    const pool={query:(q,p)=>raw.query(rewrite(q),p),async connect(){const c=await raw.connect();return {query:(q,p)=>c.query(rewrite(q),p),release:()=>c.release()};}};
    const repo=createOAuthRepository(pool);
    try {
        await raw.query(`create schema ${schema}`);
        for(const table of ['auth_user','auth_session','oauth_login_state'])await raw.query(`create table ${schema}.${table} (like public.${table} including all)`);
        await t.test('concurrent registration creates only one USER, no character or role assignment',async()=>{
            const users=await Promise.all([repo.resolveOAuthUser('survival-bob.site','123'),repo.resolveOAuthUser('survival-bob.site','123')]);
            assert.equal(users[0].id,users[1].id);assert.equal(users[0].role,'USER');assert.equal(users[0].character_id,null);
            assert.equal((await pool.query('select * from public.auth_user')).rowCount,1);
            assert.ok((await pool.query('select oauth_verified_at from public.auth_user')).rows[0].oauth_verified_at);
            const other=await repo.resolveOAuthUser('other.example','123');assert.notEqual(other.id,users[0].id);
        });
        await t.test('existing HTTPS identity preserves role and character; inactive rejected',async()=>{
            await pool.query("insert into public.auth_user(role,mastodon_instance,mastodon_account_id,character_id) values('ADMIN','https://survival-bob.site/','456',99)");
            const user=await repo.resolveOAuthUser('survival-bob.site','456');assert.equal(user.role,'ADMIN');assert.equal(user.character_id,'99');
            await pool.query('update public.auth_user set is_active=false where id=$1',[user.id]);
            await assert.rejects(repo.resolveOAuthUser('survival-bob.site','456'),{code:'USER_UNAVAILABLE'});
        });
        await t.test('state is browser-bound, expires and can be consumed by exactly one instance',async()=>{
            const state=digest('state'),browser=digest('browser');await repo.saveOAuthState(state,browser);
            assert.equal(await repo.consumeOAuthState(state,digest('wrong')),false);
            const results=await Promise.all([repo.consumeOAuthState(state,browser),createOAuthRepository(pool).consumeOAuthState(state,browser)]);
            assert.equal(results.filter(Boolean).length,1);
            await repo.saveOAuthState(state,browser);await pool.query("update public.oauth_login_state set expires_at=clock_timestamp()-interval '1 second'");
            assert.equal(await repo.consumeOAuthState(state,browser),false);
        });
        await t.test('hashed sessions expire, see live role changes and are revoked',async()=>{
            const user=await repo.resolveOAuthUser('survival-bob.site','789'),hash=digest('test-session');
            await repo.saveOAuthSession(hash,user.id);assert.equal((await repo.getOAuthSession(hash)).role,'USER');
            await pool.query("update public.auth_user set role='ADMIN' where id=$1",[user.id]);
            assert.equal((await repo.getOAuthSession(hash)).role,'ADMIN');
            await pool.query("update public.auth_session set expires_at=clock_timestamp()-interval '1 second'");assert.equal(await repo.getOAuthSession(hash),null);
            await repo.saveOAuthSession(hash,user.id);await repo.revokeOAuthSession(hash);assert.equal(await repo.getOAuthSession(hash),null);
        });
        await t.test('write error leaves no partially created account',async()=>{
            await assert.rejects(repo.resolveOAuthUser('survival-bob.site','x'.repeat(10000)));
            assert.equal((await pool.query("select * from public.auth_user where mastodon_account_id like 'xxx%'")).rowCount,0);
        });
        await t.test('final-domain mock OAuth HTTP flow with real DB, independent devices and fixed expiry',async()=>{
            const config=loadEdgeConfig({EDGE_PROJECT_REF:'grkohfxvafbquhmgnvwj',FRONTEND_ORIGIN:'https://survivalbob.site',
                PUBLIC_API_BASE_URL:'https://api.survivalbob.site/functions/v1/api',
                EDGE_DATABASE_URL:'postgresql://postgres.grkohfxvafbquhmgnvwj:fixture@fixture.pooler.supabase.com:6543/postgres',
                MASTODON_CLIENT_ID:'fixture-client',MASTODON_CLIENT_SECRET:'fixture-secret'});
            let challenge;
            const fetchImpl=async(url,options)=>{
                if(url==='https://survival-bob.site/oauth/token'){
                    assert.equal(options.body.get('redirect_uri'),config.oauthRedirect);
                    const {createHash}=await import('node:crypto');
                    assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'),challenge);
                    return Response.json({access_token:'mock-private-token',token_type:'Bearer',scope:'profile'});
                }
                assert.equal(url,'https://survival-bob.site/api/v1/accounts/verify_credentials');
                assert.equal(options.headers.Authorization,'Bearer mock-private-token');
                return Response.json({id:'98765',username:'BOB_ADMIN'});
            };
            const server=createApp(config,repo,{fetchImpl}).listen(0,'127.0.0.1');
            await new Promise(r=>server.once('listening',r));
            try {
                const base=`http://127.0.0.1:${server.address().port}/api`;
                const request=(path,opts={})=>fetch(base+path,{redirect:'manual',...opts});
                async function login(){
                    const start=await request('/auth/mastodon/login');assert.equal(start.status,302);
                    const location=new URL(start.headers.get('location'));challenge=location.searchParams.get('code_challenge');
                    assert.equal(location.searchParams.get('code_challenge_method'),'S256');
                    assert.equal(location.searchParams.get('redirect_uri'),'https://api.survivalbob.site/functions/v1/api/auth/mastodon/callback');
                    const callback='/auth/mastodon/callback?code=mock&state='+location.searchParams.get('state');
                    const headers={Cookie:start.headers.get('set-cookie').split(';')[0]};
                    const result=await request(callback,{headers});assert.equal(result.status,303);
                    assert.equal(result.headers.get('location'),'https://survivalbob.site/');
                    const replay=await request(callback,{headers});assert.equal(replay.status,303);assert.equal(replay.headers.get('location'),'https://survivalbob.site/#oauth_error=OAUTH_STATE_INVALID');
                    const cookie=result.headers.get('set-cookie');assert.match(cookie,/Max-Age=604800/);assert.match(cookie,/SameSite=Lax/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);
                    return cookie.match(/__Host-sangjonbap-session=[a-f0-9]{64}/)[0];
                }
                const pc=await login(),mobile=await login();assert.notEqual(pc,mobile);
                const hash=digest(mobile.split('=')[1]);
                const before=(await pool.query('select expires_at,extract(epoch from expires_at-clock_timestamp()) as remaining from public.auth_session where token_hash=$1',[hash])).rows[0];
                assert.ok(Number(before.remaining)>604790&&Number(before.remaining)<=604800);
                for(const cookie of [pc,mobile]){
                    const me=await request('/auth/me',{headers:{Cookie:cookie,Origin:config.origin}});
                    assert.equal(me.headers.get('access-control-allow-origin'),config.origin);
                    assert.equal((await me.json()).data.user.role,'USER');
                }
                assert.equal((await pool.query('select expires_at from public.auth_session where token_hash=$1',[hash])).rows[0].expires_at.getTime(),before.expires_at.getTime());
                assert.equal((await request('/auth/logout',{method:'POST',headers:{Cookie:pc,Origin:config.origin}})).status,200);
                assert.equal((await request('/auth/me',{headers:{Cookie:pc}})).status,401);
                assert.equal((await request('/auth/me',{headers:{Cookie:mobile}})).status,200);
                await pool.query("update public.auth_session set expires_at=clock_timestamp()-interval '1 second' where token_hash=$1",[hash]);
                const expired=await request('/auth/me',{headers:{Cookie:mobile}});assert.equal(expired.status,401);assert.match(expired.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);
            } finally {await new Promise(r=>server.close(r));}
        });
    } finally {await raw.query(`drop schema if exists ${schema} cascade`);await raw.end();}
});
