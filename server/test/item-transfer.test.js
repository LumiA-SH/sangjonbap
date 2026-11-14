import {dailyGateFixture} from './daily-gate-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createInventoryRepository} from '../src/modules/inventory/repository.js';
import {createInventoryService} from '../src/modules/inventory/service.js';
import {createBloodPackRepository} from '../src/modules/inventory/blood-pack.js';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';

const rows = values => ({rows: values, rowCount: values.length});
// Serialized transaction model, not a substitute for PostgreSQL lock tests.
function fixture({provider = {}, target = {}, item = {}, active = [], quantity = 5, received = 1, failLog = false} = {}) {
    let state = {quantities: {'2': quantity, '10': received}, keys: [], logs: []};
    let queue = Promise.resolve();
    const statements = [];
    const characters = {
        '2': {id: '2', name: '송신자', hp: 100, blood: 50, status: 'ALIVE', ...provider},
        '10': {id: '10', name: '수령자', hp: 100, blood: 50, status: 'ALIVE', ...target}
    };
    const pool = {        
async connect() {
            const previous = queue;
            let unlock;
            queue = new Promise(resolve => {unlock = resolve;});
            await previous;
            let snapshot;
            return {
                release() {unlock();},
                async query(sql, params = []) {                    
const dailyGateResult = dailyGateFixture(sql); if (dailyGateResult) return dailyGateResult;
                    sql = sql.replace(/\s+/g, ' ').trim(); statements.push({sql, params});
                    if (sql === 'begin') {snapshot = structuredClone(state); return rows([]);}
                    if (sql === 'commit') return rows([]);
                    if (sql === 'rollback') {state = snapshot; return rows([]);}
                    if (sql.startsWith('select character_id from public.auth_user')) return rows([{character_id: '2'}]);
                    if (sql.startsWith('select * from public.game_character')) return rows(characters[params[0]] ? [characters[params[0]]] : []);
                    if (sql.startsWith('select id from public.action_log')) return rows(state.keys.includes(params[0]) ? [{id: 1}] : []);
                    if (sql.startsWith('select id from public.battle')) return rows(active.includes(params[0]) ? [{id: 1}] : []);
                    if (sql.startsWith('select * from public.item')) return rows([{id: '7', name: '아이템', is_active: true, transferable: true, ...item}]);
                    if (sql.startsWith('select id,quantity from public.inventory')) return rows([{id: params[0], quantity: state.quantities[params[0]]}]);
                    if (sql.startsWith('select quantity from public.inventory')) return rows([{quantity: state.quantities[params[0]]}]);
                    if (sql.startsWith('update public.inventory')) {state.quantities[params[1]] = params[0]; return rows([]);}
                    if (sql.startsWith('insert into public.action_log')) {
                        if (failLog === true || (failLog === 'receive' && params[0] === '10')) throw new Error('audit failure');
                        state.keys.push(params[8]); state.logs.push({action: params[3], target: params[5], detail: JSON.parse(params[7])});
                        return rows([]);
                    }
                    throw new Error(`Unexpected SQL: ${sql}`);
                }
            };
        }    
};
    return {pool, statements, state: () => state, repo: createInventoryRepository(pool)};
}

test('general transfer atomically updates both inventories, logs and sorts character IDs numerically', async () => {
    const f = fixture();
    const result = await f.repo.transferItem('1', '10', '7', 3, randomUUID());
    assert.deepEqual(result, {itemId: '7', targetId: '10', quantity: 3, providerQuantity: 2, targetQuantity: 4});
    assert.deepEqual(f.state().quantities, {'2': 2, '10': 4});
    assert.equal(f.state().logs[0].action, 'ITEM_TRANSFER');
    assert.equal(f.state().logs[0].target, '10');
    assert.equal(f.state().logs[1].action, 'ITEM_RECEIVE'); assert.equal(f.state().logs[1].target, '2');
    for (const log of f.state().logs) {assert.equal(log.detail.providerName, '송신자'); assert.equal(log.detail.targetName, '수령자'); assert.equal(log.detail.itemName, '아이템'); assert.equal(log.detail.quantity, 3);}
    assert.deepEqual(f.statements.filter(s => s.sql.startsWith('select * from public.game_character')).map(s => s.params[0]), ['2', '10']);
    assert.equal(f.statements.at(-1).sql, 'commit');
});

test('near-death sender and recipient may transfer ordinary items under v0.2', async () => {
    const f = fixture({provider: {status: 'NEAR_DEATH', blood: 0}, target: {status: 'NEAR_DEATH', blood: 0}});
    await f.repo.transferItem('1', '10', '7', 1, randomUUID());
    assert.deepEqual(f.state().quantities, {'2': 4, '10': 2});
});

for (const [name, options, targetId, code] of [
    ['dead sender', {provider: {status: 'DEAD', hp: 0}}, '10', 'CHARACTER_DEAD'],
    ['dead recipient', {target: {status: 'DEAD', hp: 0}}, '10', 'CHARACTER_DEAD'],
    ['sender in battle', {active: ['2']}, '10', 'BATTLE_ACTIVE'],
    ['recipient in battle', {active: ['10']}, '10', 'BATTLE_ACTIVE'],
    ['self transfer', {}, '2', 'SELF_TRANSFER'],
    ['missing recipient', {}, '99', 'CHARACTER_NOT_FOUND'],
    ['inactive item', {item: {is_active: false}}, '10', 'ITEM_NOT_FOUND'],
    ['nontransferable item', {item: {transferable: false}}, '10', 'ITEM_NOT_TRANSFERABLE'],
    ['insufficient inventory', {quantity: 0}, '10', 'NOT_ENOUGH_ITEMS'],
    ['recipient overflow', {received: 2147483647}, '10', 'INVENTORY_LIMIT_CONFLICT']
]) test(`transfer rejects ${name} and rolls back`, async () => {
    const f = fixture(options), before = structuredClone(f.state());
    await assert.rejects(f.repo.transferItem('1', targetId, '7', 1, randomUUID()), {code});
    assert.deepEqual(f.state(), before);
    assert.equal(f.statements.at(-1).sql, 'rollback');
});

test('audit failure rolls back both inventory changes', async () => {
    const f = fixture({failLog: true}), before = structuredClone(f.state());
    await assert.rejects(f.repo.transferItem('1', '10', '7', 1, randomUUID()), /audit failure/);
    assert.deepEqual(f.state(), before);
});

test('serialized retries and competing transfers cannot spend the same last item in transaction model', async () => {
    const f = fixture({quantity: 1}), key = randomUUID();
    const results = await Promise.allSettled([
        f.repo.transferItem('1', '10', '7', 1, key), f.repo.transferItem('1', '10', '7', 1, key),
        f.repo.transferItem('1', '10', '7', 1, randomUUID())
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results[1].reason.code, 'DUPLICATE_REQUEST');
    assert.equal(results[2].reason.code, 'NOT_ENOUGH_ITEMS');
    assert.deepEqual(f.state().quantities, {'2': 0, '10': 2});
    assert.equal(f.state().logs.length, 2);
});

test('blood-pack endpoint retains explicit validation and historical log type', async () => {
    const f = fixture({item: {effect_type: 'BLOOD_PACK', effect_value: 10, usable: true, use_target: 'SELF'}});
    await createBloodPackRepository(f.pool).transferBloodPack('1', '10', '7', 1, randomUUID());
    assert.equal(f.state().logs[0].action, 'BLOOD_PACK_TRANSFER');
    assert.equal(f.state().logs[1].action, 'BLOOD_PACK_RECEIVE');
    const ordinary = fixture();
    await assert.rejects(createBloodPackRepository(ordinary.pool).transferBloodPack('1', '10', '7', 1, randomUUID()), {code: 'BLOOD_PACK_CONFIG_INVALID'});
});

test('transfer service validates quantity, bigint string IDs and UUID before repository access', async () => {
    const calls = [], service = createInventoryService({transferItem: (...args) => {calls.push(args); return 'ok';}});
    const body = {targetId: '10', itemId: '7', quantity: 1, requestKey: randomUUID()};
    for (const patch of [{quantity: 0}, {quantity: 1.5}, {quantity: 2147483648}, {targetId: '0'},
    {targetId: '9223372036854775808'}, {itemId: 7}, {requestKey: 'bad'}, {userId: '9'}]) {
        await assert.rejects(service.transfer('1', {...body, ...patch}));
    }
    assert.equal(calls.length, 0);
    assert.equal(await service.transfer('1', body), 'ok');
    assert.deepEqual(calls[0], ['1', '10', '7', 1, body.requestKey]);
});

test('transfer HTTP requires authentication and always uses session owner', async t => {
    const calls = [], repo = createMemoryRepository();
    repo.transferItem = async (...args) => {calls.push(args); return {quantity: 1};};
    const server = createApp({mode: 'memory', origin: 'http://localhost:3000', loginKey: 'local-test', userId: '1'}, repo).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const body = {targetId: '10', itemId: '7', quantity: 1, requestKey: randomUUID()};
    const post = (path, value, token) => fetch(base + path, {        
method: 'POST', headers: {
            'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})
        }, body: JSON.stringify(value)    
});
    assert.equal((await post('/inventory/transfer', body)).status, 401);
    const login = await (await post('/auth/dev/login', {key: 'local-test'})).json();
    assert.equal((await post('/inventory/transfer', {...body, userId: '2'}, login.data.token)).status, 400);
    assert.equal((await post('/inventory/transfer', body, login.data.token)).status, 200);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], '1');
});

test('recipient audit failure rolls back sender log and both inventories', async () => {const f = fixture({failLog: 'receive'}), before = structuredClone(f.state()); await assert.rejects(f.repo.transferItem('1', '10', '7', 1, randomUUID()), /audit failure/); assert.deepEqual(f.state(), before);});
