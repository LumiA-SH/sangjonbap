import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordsRepository, playerActionRecord} from '../src/modules/records/repository.js';
import {recordsPage, recordsCursor} from '../src/modules/records/routes.js';
import {createApp} from '../src/app.js';

test('historical gacha logs cannot reveal weights or candidate lists to players', () => {
    const stored = {id: '1', category: 'GACHA', detail: {price: 1, totalWeight: 10, candidates: [{weight: 5}], reward: {itemId: '7', quantity: 1, weight: 5, probability: 50}}};
    assert.deepEqual(playerActionRecord(stored).detail, {price: 1, reward: {itemId: '7', quantity: 1}});
    assert.equal(stored.detail.reward.weight, 5);
});

test('records queries are read-only, scoped, bounded and do not expose undiscovered clues', async () => {
    const calls = [];
    const repo = createRecordsRepository({async query(sql, params) {calls.push({sql, params}); return {rows: []};} });
    await repo.getActionRecords('7', '20');
    await repo.getActionRecords('7', null, true);
    await repo.getAdminActionRecords('7', '19');
    await repo.getDiscoveryRecords('7');
    await repo.getClueRecords('7', '4');
    for (const {sql} of calls) {
        assert.match(sql, /^select /); assert.match(sql, /limit 31/);
        assert.doesNotMatch(sql, /token|mastodon_account_id|password|for update|insert|delete/);
    }
    assert.match(calls[0].sql, /u.id=\$1 and u.is_active and c.is_active/);
    assert.match(calls[0].sql, /order by l.created_at desc,l.id desc/);
    assert.deepEqual(calls[1].params, ['7', null, true]);
    assert.match(calls[2].sql, /role='ADMIN'/);
    assert.match(calls[3].sql, /from public.unique_discovery d/);
    assert.match(calls[4].sql, /cl.is_discovered=true/);
    assert.match(calls[4].sql, /u.id=\$1 and u.is_active and own.is_active/);
    assert.doesNotMatch(calls[4].sql, /status='ALIVE'/);
});

test('record pagination rejects client-selected identity and provides a bounded next cursor', () => {
    for (const query of [{userId: '2'}, {characterId: '2'}, {before: '0'}, {before: ['1']}, {before: '9223372036854775808'}]) assert.throws(() => recordsCursor(query));
    assert.equal(recordsCursor({before: '9007199254740993'}), '9007199254740993');
    assert.equal(recordsCursor({}), null);
    const rows = Array.from({length: 31}, (_, i) => ({id: String(100 - i)}));
    assert.equal(recordsPage(rows).records.length, 30);
    assert.equal(recordsPage(rows).nextBefore, '71');
    assert.equal(recordsPage(rows.slice(0, 30)).nextBefore, null);
});

test('production cookie auth permits own records, blocks unlinked users and non-admin full logs', async t => {
    let user = {id: '7', character_id: '10', role: 'USER', is_active: true};
    const calls = [];
    const repo = {
        getOAuthSession: async () => user,
        listAdminRecords: async () => [], getAdminRecord: async () => ({}), saveAdminRecord: async () => ({})
    };
    for (const name of ['getActionRecords', 'getClueRecords', 'getDiscoveryRecords', 'getAdminActionRecords']) {
        repo[name] = async (...args) => {calls.push({name, args}); return [{id: '5'}];};
    }
    const config = {provider: 'mastodon', nodeEnv: 'production', origin: 'https://survivalbob.site'};
    const server = createApp(config, repo).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const get = (path, auth = true) => fetch(base + path, {headers: auth ? {Cookie: '__Host-sangjonbap-session=' + 'a'.repeat(64)} : {}});
    assert.equal((await get('/records/clues', false)).status, 401);
    assert.equal((await get('/records/action-logs?requestKey=12345678-1234-4234-8234-123456789012', false)).status, 401);
    assert.equal((await get('/records/action-logs')).status, 200);
    assert.deepEqual(calls[0], {name: 'getActionRecords', args: ['7', null, false]});
    assert.equal((await get('/records/investigations?before=9')).status, 200);
    assert.deepEqual(calls[1].args, ['7', '9', true]);
    assert.equal((await get('/records/clues?userId=2')).status, 400);
    assert.equal((await get('/admin/action-logs')).status, 403);
    assert.equal((await get('/dev/action-logs')).status, 404);
    assert.equal((await get('/records/action-logs?requestKey=12345678-1234-4234-8234-123456789012&userId=8')).status, 400);
    assert.equal((await get('/records/action-logs?requestKey=12345678-1234-4234-8234-123456789012')).status, 200); assert.deepEqual(calls.at(-1).args, ['7', null, false, '12345678-1234-4234-8234-123456789012']);
    user = {...user, character_id: null};
    assert.equal((await get('/records/clues')).status, 403);
    user = {...user, role: 'ADMIN'};
    assert.equal((await get('/admin/action-logs?before=9')).status, 200);
    assert.deepEqual(calls.at(-1), {name: 'getAdminActionRecords', args: ['7', '9']});
    user = {...user, role: 'USER'};
    assert.equal((await get('/admin/action-logs')).status, 403);
});

test('request key filtering remains scoped to session owner', async () => {
    let query, params; await createRecordsRepository({query: async (q, p) => {query = q; params = p; return {rows: []};}}).getActionRecords('7', null, false, '12345678-1234-4234-8234-123456789012'); assert.match(query, /u.id=\$1 and u.is_active and c.is_active/); assert.match(query, /l.request_key=\$4::uuid/); assert.deepEqual(params, ['7', null, false, '12345678-1234-4234-8234-123456789012']);
});
