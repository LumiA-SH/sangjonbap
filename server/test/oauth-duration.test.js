import test from 'node:test';
import assert from 'node:assert/strict';
import {createOAuthSessions, sessionLifetimeSeconds, sessionCookie} from '../src/modules/auth/oauth-session.js';
import {createOAuthRepository} from '../src/modules/auth/oauth-repository.js';
test('seven day fixed sessions, boundary, independent devices and expiry cookie cleanup', async () => {
    let now = 0; const rows = new Map(); let writes = 0;
    const repo = {saveOAuthSession: async (hash, id) => {writes++; rows.set(hash, {expires: now + sessionLifetimeSeconds * 1000, id});}, getOAuthSession: async (hash) => {const r = rows.get(hash); return r && now < r.expires ? {id: r.id} : null;}, revokeOAuthSession: async (hash) => rows.delete(hash)};
    const sessions = createOAuthSessions(repo, 'https://survivalbob.site'), pc = await sessions.issue({id: 1}), mobile = await sessions.issue({id: 1});
    assert.equal(pc.expiresIn, 604800); assert.notEqual(pc.token, mobile.token);
    let clears = 0; const res = {clearCookie: (name, opts) => {assert.equal(name, sessionCookie); assert.equal(opts.httpOnly, true); assert.equal(opts.secure, true); clears++;}};
    const auth = token => sessions.require({method: 'GET', headers: {cookie: sessionCookie + '=' + token}}, res, () => {});
    now = 604800000 - 1; await auth(pc.token); await auth(mobile.token); assert.equal(writes, 2);
    await sessions.revoke(pc.token); await assert.rejects(auth(pc.token), {code: 'UNAUTHORIZED'}); await auth(mobile.token);
    now = 604800000; await assert.rejects(auth(mobile.token), {code: 'UNAUTHORIZED'}); assert.equal(clears, 2);
});
test('repository uses shared duration at issuance, strict expiry reads and unchanged five minute state', async () => {
    const calls = []; const repo = createOAuthRepository({query: async (sql, args) => {calls.push({sql, args}); return {rows: [], rowCount: 0};}});
    await repo.saveOAuthSession('hash', 1); assert.equal(calls[1].args[2], 604800); assert.match(calls[1].sql, /clock_timestamp\(\)\+\$3 \* interval '1 second'/);
    calls.length = 0; await repo.getOAuthSession('hash'); assert.equal(calls.length, 1); assert.match(calls[0].sql, /expires_at>clock_timestamp\(\)/); assert.ok(!/update/i.test(calls[0].sql));
    calls.length = 0; await repo.saveOAuthState('a', 'b'); assert.match(calls[1].sql, /interval '5 minutes'/);
});
