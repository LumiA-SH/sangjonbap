import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';
import {loadConfig} from '../src/config/env.js';
import {createHash} from 'node:crypto';
import {requireOAuthVerifiedAccount} from '../scripts/bootstrap-admin.js';

const config = {    
provider: 'mastodon', nodeEnv: 'production', mode: 'supabase', origin: 'https://survivalbob.site',
    oauthRedirect: 'https://survivalbob.site/api/auth/mastodon/callback', oauthClientId: 'fixture-client', oauthClientSecret: 'fixture-secret'
};
async function fixture(t) {
    const states = new Map(), sessions = new Map(), user = {id: '1', role: 'USER', is_active: true, character_id: null};
    let fail = false, exchangeCount = 0, resolveFail = false;
    const repo = {
        async saveOAuthState(hash, browser) {states.set(hash, browser);},
        async consumeOAuthState(hash, browser) {if (states.get(hash) !== browser) return false; states.delete(hash); return true;},
        async resolveOAuthUser(instance, id) {if (resolveFail) throw new Error('private-db-error'); assert.equal(instance, 'survival-bob.site'); assert.equal(id, '123'); return {...user};},
        async saveOAuthSession(hash) {sessions.set(hash, true);}, async revokeOAuthSession(hash) {sessions.delete(hash);},
        async getOAuthSession(hash) {return sessions.has(hash) && user.is_active ? {...user} : null;},
        async listAdminRecords() {return [];}, async getAdminRecord() {return {};}, async saveAdminRecord() {return {};}
    };
    const fetchImpl = async (url, options) => {
        assert.equal(options.redirect, 'error');
        if (url.endsWith('/oauth/token')) {
            exchangeCount++; if (fail) throw new Error('fixture-secret MUST NOT LEAK');
            assert.equal(options.body.get('code_verifier').length, 43);
            assert.equal(options.body.get('client_secret'), 'fixture-secret');
            assert.equal(options.body.get('redirect_uri'), config.oauthRedirect);
            return Response.json({access_token: 'private-fixture-token', token_type: 'Bearer', scope: 'profile'});
        }
        assert.equal(url, 'https://survival-bob.site/api/v1/accounts/verify_credentials');
        assert.equal(options.headers.Authorization, 'Bearer private-fixture-token');
        return Response.json({id: '123', username: 'BOB_ADMIN'});
    };
    const server = createApp(config, repo, {fetchImpl}).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    t.after(() => new Promise(r => server.close(r)));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const request = (path, opts = {}) => fetch(base + path, {redirect: 'manual', ...opts});
    async function begin() {        
const r = await request('/auth/mastodon/login'); const url = new URL(r.headers.get('location'));
        assert.equal(url.origin, 'https://survival-bob.site'); assert.equal(url.searchParams.get('scope'), 'profile');
        assert.match(r.headers.get('set-cookie'), /Max-Age=300/);
        const cookie = r.headers.get('set-cookie').split(';')[0], verifier = cookie.split('=')[1];
        assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
        return {cookie, path: '/auth/mastodon/callback?code=fixture-code&state=' + url.searchParams.get('state')};    
}
    return {request, begin, user, states, sessions, setFail: v => {fail = v;}, count: () => exchangeCount, setResolveFail: () => {resolveFail = true;}};
}
test('OAuth binds browser/state/PKCE, rotates session, respects role and logs out', async t => {
    const f = await fixture(t), first = await f.begin();
    const success = await f.request(first.path, {headers: {Cookie: first.cookie}});
    assert.equal(success.status, 303); assert.equal(success.headers.get('location'), 'https://survivalbob.site/');
    const raw = success.headers.get('set-cookie'); assert.match(raw, /Max-Age=604800/); assert.match(raw, /HttpOnly/); assert.match(raw, /Secure/); assert.match(raw, /SameSite=Lax/);
    const cookie = raw.match(/__Host-sangjonbap-session=[a-f0-9]{64}/)[0];
    const me = await f.request('/auth/me', {headers: {Cookie: cookie}}); const body = await me.json();
    assert.equal(body.data.user.role, 'USER'); assert.ok(!JSON.stringify(body).includes('token'));
    assert.equal((await f.request('/admin/items', {headers: {Cookie: cookie}})).status, 403);
    f.user.role = 'ADMIN'; assert.equal((await f.request('/admin/items', {headers: {Cookie: cookie}})).status, 200);
    assert.equal((await f.request('/auth/logout', {method: 'POST', headers: {Cookie: cookie}})).status, 403);
    assert.equal((await f.request('/characters/me/resources', {method: 'PATCH', headers: {Cookie: cookie, Origin: config.origin}})).status, 403);
    assert.equal((await f.request('/characters', {method: 'POST', headers: {Cookie: cookie, Origin: config.origin}})).status, 403);
    const creations = await Promise.all([1, 2].map(() => f.request('/characters', {method: 'POST', headers: {Cookie: cookie, Origin: config.origin, 'Content-Type': 'application/json'}, body: JSON.stringify({hunter_grade: 'S', atk: 16, def: 15, agi: 15})})));
    assert.deepEqual(creations.map(r => r.status), [403, 403]); assert.equal(f.user.character_id, null);
    f.user.character_id = '5'; assert.equal((await f.request('/characters', {method: 'POST', headers: {Cookie: cookie, Origin: config.origin}})).status, 409);
    const next = await f.begin(); await f.request(next.path, {headers: {Cookie: next.cookie + '; ' + cookie}});
    assert.equal((await f.request('/auth/me', {headers: {Cookie: cookie}})).status, 401);
    assert.equal(f.sessions.size, 1);
    const final = await f.begin(), r = await f.request(final.path, {headers: {Cookie: final.cookie}});
    const finalCookie = r.headers.get('set-cookie').match(/__Host-sangjonbap-session=[a-f0-9]{64}/)[0];
    assert.equal((await f.request('/auth/logout', {method: 'POST', headers: {Cookie: finalCookie, Origin: config.origin}})).status, 200);
    assert.equal((await f.request('/auth/me', {headers: {Cookie: finalCookie}})).status, 401);
});
test('state mismatch, cookie mismatch, expired state, callback replay and exchange errors fail closed', async t => {
    const f = await fixture(t), a = await f.begin(), b = await f.begin();
    assertCallbackError(await f.request(a.path, {headers: {Cookie: b.cookie}}), 'OAUTH_STATE_INVALID'); assert.equal(f.count(), 0);
    const results = await Promise.all([f.request(a.path, {headers: {Cookie: a.cookie}}), f.request(a.path, {headers: {Cookie: a.cookie}})]);
    assert.deepEqual(results.map(r => r.headers.get('location')).sort(), ['https://survivalbob.site/', 'https://survivalbob.site/#oauth_error=OAUTH_STATE_INVALID']); assert.equal(f.count(), 1);
    f.states.clear(); assertCallbackError(await f.request(b.path, {headers: {Cookie: b.cookie}}), 'OAUTH_STATE_INVALID');
    const c = await f.begin(); f.setFail(true); const failed = await f.request(c.path, {headers: {Cookie: c.cookie}});
    assertCallbackError(failed, 'OAUTH_EXCHANGE_FAILED'); assert.ok(!(await failed.text()).includes('fixture-secret'));
    assertCallbackError(await f.request(c.path, {headers: {Cookie: c.cookie}}), 'OAUTH_STATE_INVALID');
    const d = await f.begin(); assertCallbackError(await f.request(d.path.replace('code=fixture-code', 'error=access_denied&error_description=private-value'), {headers: {Cookie: d.cookie}}), 'OAUTH_DENIED');
    assert.equal((await f.request('/auth/mastodon/login?returnTo=https://evil.example')).status, 400);
    assert.equal((await f.request('/auth/dev/login', {method: 'POST', headers: {Origin: config.origin, 'Content-Type': 'application/json'}, body: '{}'})).status, 403);
    assert.equal((await f.request('/characters', {method: 'POST', headers: {Origin: config.origin}})).status, 401);
});
test('OAuth configuration exact HTTPS callback and server credentials required', () => {
    const env = {        
AUTH_PROVIDER: 'mastodon', NODE_ENV: 'production', DATA_MODE: 'supabase', DATABASE_URL: 'fixture', FRONTEND_ORIGIN: config.origin,
        MASTODON_CLIENT_ID: 'fixture', MASTODON_CLIENT_SECRET: 'fixture', MASTODON_REDIRECT_URI: config.oauthRedirect    
};
    assert.equal(loadConfig(env).provider, 'mastodon');
    for (const patch of [{MASTODON_CLIENT_SECRET: ''}, {FRONTEND_ORIGIN: 'https://evil.example'}, {MASTODON_REDIRECT_URI: 'https://evil.example/callback'}, {DATA_MODE: 'memory'}, {AUTH_PROVIDER: 'dev'}]) assert.throws(() => loadConfig({...env, ...patch}));
});
test('first-admin CLI guard rejects absent OAuth proof without promoting accounts', async () => {
    for (const rows of [[], [{oauth_verified_at: null}]]) await assert.rejects(requireOAuthVerifiedAccount({query: async () => ({rows})}, '1'), /OAuth/);
    await requireOAuthVerifiedAccount({query: async () => ({rows: [{oauth_verified_at: new Date()}]})}, '1');
});

function assertCallbackError(response, code) {
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), 'https://survivalbob.site/#oauth_error=' + code);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(!response.headers.get('set-cookie').includes('__Host-sangjonbap-session='));
}
test('unexpected callback errors and malformed codes redirect without leaking request or internal details', async t => {
    const f = await fixture(t), a = await f.begin();
    assertCallbackError(await f.request(a.path.replace('code=fixture-code', 'returnTo=https://evil.example'), {headers: {Cookie: a.cookie}}), 'OAUTH_CODE_INVALID');
    const b = await f.begin(); f.setResolveFail();
    const response = await f.request(b.path + '&returnTo=https://evil.example', {headers: {Cookie: b.cookie}});
    assertCallbackError(response, 'OAUTH_LOGIN_FAILED');
    assert.ok(!(await response.text()).includes('private-db-error')); assert.equal(f.sessions.size, 0);
});
