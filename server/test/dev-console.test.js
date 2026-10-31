import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';
import {manageDevCareAccount} from '../scripts/dev-care-account.js';

async function setup(t, overrides = {}) {
    const config = {nodeEnv: 'development', provider: 'dev', userId: '1',
        loginKey: 'dev-test-only-key', origin: 'http://localhost:3000', ...overrides};
    const repository = createMemoryRepository();
    const calls = [];
    repository.getDevActionLogs = async (...args) => { calls.push(args); return [{id: '3', action_type: 'HEAL'}]; };
    const server = createApp(config, repository).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const signed = await fetch(base + '/auth/dev/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: config.loginKey})});
    const token = (await signed.json()).data?.token;
    return {repository, calls, async get(query = '', authenticated = true) {
        const response = await fetch(base + '/dev/action-logs' + query, {headers: authenticated ? {Authorization: `Bearer ${token}`} : {}});
        return {status: response.status, body: await response.json()};
    }};
}

test('DEV logs require login, server-owned identity and valid scoped query', async t => {
    const f = await setup(t);
    assert.equal((await f.get('', false)).status, 401);
    assert.equal((await f.get()).status, 200);
    assert.deepEqual(f.calls, [['1', null]]);
    assert.equal((await f.get('?characterId=2')).status, 400);
    assert.equal((await f.get('?requestKey=bad')).status, 400);
    f.repository.getUser = async () => ({id: '2', is_active: true});
    assert.equal((await f.get()).status, 403);
});

for (const config of [{nodeEnv: 'production'}, {nodeEnv: 'test'}, {provider: 'oauth'}]) {
    test(`DEV logs unavailable for ${JSON.stringify(config)}`, async t => {
        const f = await setup(t, config);
        assert.equal((await f.get()).status, 404);
        assert.equal(f.calls.length, 0);
    });
}

test('DEV care seed reuses its marked account without changing resources; conflict rejects', async () => {
    const queries = [];
    const character = {id: '8', profile_image_url: 'urn:sangjonbap:dev:care-account:v1', is_active: true};
    const client = {async query(sql) {
        queries.push(sql);
        if (sql.startsWith('select * from public.game_character')) return {rowCount: 1, rows: [character]};
        if (sql.startsWith('select id,role')) return {rowCount: 1, rows: [{id: '9', role: 'USER', is_active: true}]};
        return {rowCount: 0, rows: []};
    }};
    assert.equal((await manageDevCareAccount(client)).characterId, '8');
    assert.equal((await manageDevCareAccount(client)).characterId, '8');
    assert.equal(queries.some(sql => /^(insert|update|delete)/.test(sql)), false);
    character.profile_image_url = null;
    await assert.rejects(manageDevCareAccount(client), /충돌/);
});
