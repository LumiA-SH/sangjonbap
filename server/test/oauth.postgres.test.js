import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool as createPool} from './isolated-pool.js';
import {createOAuthRepository} from '../src/modules/auth/oauth-repository.js';
import {digest} from '../src/modules/auth/oauth-session.js';

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
    } finally {await raw.query(`drop schema if exists ${schema} cascade`);await raw.end();}
});
