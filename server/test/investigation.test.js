import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvestigationRepository} from '../src/modules/investigation/repository.js';
import {createInvestigationService} from '../src/modules/investigation/service.js';
import {chooseResult, winsReward} from '../src/modules/investigation/random.js';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';

const key = '12345678-1234-4234-8234-123456789abc';
const key2 = '12345678-1234-4234-8234-123456789abd';
const rows = values => ({rows: values, rowCount: values.length});
const clone = value => structuredClone(value);

function fixture(overrides = {}, {random = () => 0, failAt, duplicateAtLog = false} = {}) {
  let state = {
    character: {id: '10', hp: 100, max_hp: 100, blood: 100, max_blood: 100,
      ap: 3, max_ap: 10, currency: 0, status: 'ALIVE', death_count: 0},
    area: {id: '1', name: '폐허', is_open: true, unlock_at: null, investigation_rate: '0'},
    results: [{id: '2', area_id: '1', result_grade: 'NORMAL', result_text: '발견했다.',
      weight: 1, is_unique: false, investigation_rate_value: '15', clue_id: null}],
    rewards: [], items: [{id: '3', name: '식량', is_active: true}], inventory: {},
    discoveries: [], logs: [], clue: {id: '4', title: '단서', content: '내용'}, ...clone(overrides)
  };
  let snapshot;
  let released = 0;
  const calls = [];
  const client = {
    async query(source, params = []) {
      const sql = source.replace(/\s+/g, ' ').trim();
      calls.push({sql, params});
      if (failAt && sql.startsWith(failAt)) throw new Error('injected failure');
      if (sql === 'begin') { snapshot = clone(state); return rows([]); }
      if (sql === 'rollback') { state = snapshot; return rows([]); }
      if (sql === 'commit') return rows([]);
      if (sql.startsWith('select id from public.action_log')) return rows(state.logs.filter(log => log.requestKey === params[0]));
      if (sql.startsWith('select * from public.area')) {
        assert.match(sql, /for update$/); return rows(state.area ? [clone(state.area)] : []);
      }
      if (sql.startsWith('select ($1::boolean')) return rows([{accessible: params[0] && (!params[1] || Date.parse(params[1]) <= Date.now())}]);
      if (sql.startsWith('select c.*')) {
        assert.match(sql, /for update of u,c$/); assert.deepEqual(params, ['7']);
        return rows(state.character ? [clone(state.character)] : []);
      }
      if (sql.startsWith('select * from public.investigation_result')) {
        assert.match(sql, /where area_id=\$1 and is_active order by id for share$/);
        return rows(clone(state.results));
      }
      if (sql.startsWith('update public.game_character')) {
        ['hp', 'blood', 'ap', 'currency', 'status', 'death_count'].forEach((name, i) => { state.character[name] = params[i]; });
        return rows([clone(state.character)]);
      }
      if (sql.startsWith('insert into public.unique_discovery')) {
        assert.match(sql, /on conflict \(investigation_result_id\) do nothing returning id$/);
        if (state.discoveries.includes(params[0])) return rows([]);
        state.discoveries.push(params[0]); return rows([{id: '100'}]);
      }
      if (sql.startsWith('update public.area')) {
        assert.match(sql, /least\(100,investigation_rate\+\$1::numeric\)/);
        state.area.investigation_rate = String(Math.min(100, Number(state.area.investigation_rate) + Number(params[0])));
        return rows([clone(state.area)]);
      }
      if (sql.startsWith('select * from public.investigation_reward')) {
        assert.match(sql, /order by item_id,id for share$/); return rows(clone(state.rewards));
      }
      if (sql.startsWith('select id,name,is_active from public.item')) {
        assert.match(sql, /for update$/); return rows(clone(state.items.filter(item => item.id === params[0])));
      }
      if (sql.startsWith('select id,quantity from public.inventory')) {
        assert.match(sql, /for update$/);
        return rows(Object.hasOwn(state.inventory, params[1]) ? [{id: params[1], quantity: state.inventory[params[1]]}] : []);
      }
      if (sql.startsWith('insert into public.inventory')) { state.inventory[params[1]] = params[2]; return rows([]); }
      if (sql.startsWith('update public.inventory')) { state.inventory[params[1]] = params[0]; return rows([]); }
      if (sql.startsWith('select * from public.clue')) return rows([clone(state.clue)]);
      if (sql.startsWith('insert into public.action_log')) {
        if (duplicateAtLog || state.logs.some(log => log.requestKey === params[8])) {
          throw Object.assign(new Error('duplicate'), {code: '23505', constraint: 'action_log_request_key_key'});
        }
        state.logs.push({characterId: params[0], category: params[2], actionType: params[3],
          targetType: params[4], targetId: params[5], detail: JSON.parse(params[7]), requestKey: params[8]});
        return rows([]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() { released++; }
  };
  return {repository: createInvestigationRepository({connect: async () => client}, {random}),
    state: () => state, calls, released: () => released};
}

const reward = {id: '5', item_id: '3', quantity: 2, probability: '100'};
const unique = {id: '2', area_id: '1', result_grade: 'RARE', result_text: '최초 단서',
  weight: 1, is_unique: true, investigation_rate_value: '15', clue_id: '4'};

test('normal investigation deducts exactly one AP, returns/logs rewards and locks in order', async () => {
  const f = fixture({rewards: [reward]});
  const result = await f.repository.investigate('7', '1', key);
  assert.equal(result.ap, 2); assert.equal(result.firstDiscovery, false);
  assert.equal(result.result.id, '2'); assert.equal(result.clue, null);
  assert.equal(result.area.investigation_rate, 0);
  assert.deepEqual(result.rewards, [{rewardId: '5', itemId: '3', name: '식량', quantity: 2, inventoryQuantity: 2}]);
  assert.equal(f.state().inventory['3'], 2);
  assert.deepEqual(f.state().logs[0], {characterId: '10', category: 'INVESTIGATION', actionType: 'INVESTIGATE',
    targetType: 'AREA', targetId: '1', requestKey: key,
    detail: {area_id: '1', result_id: '2', rewards: result.rewards, clue_id: null,
      first_discovery: false, investigation_rate_before: 0, investigation_rate_after: 0, ap_before: 3, ap_after: 2}});
  const locks = f.calls.filter(call => /for update/.test(call.sql)).map(call => call.sql);
  assert.match(locks[0], /public.area/); assert.match(locks[1], /public.game_character/);
  assert.match(locks[2], /public.item/); assert.match(locks[3], /public.inventory/);
  assert.equal(f.calls.at(-1).sql, 'commit'); assert.equal(f.released(), 1);
});

for (const [name, overrides, code] of [
  ['AP insufficient', {character: {id: '10', status: 'ALIVE', ap: 0}}, 'NOT_ENOUGH_AP'],
  ['DEAD character', {character: {id: '10', status: 'DEAD', ap: 10}}, 'CHARACTER_DEAD'],
  ['no active character', {character: null}, 'CHARACTER_NOT_FOUND'],
  ['missing area', {area: null}, 'AREA_NOT_FOUND'],
  ['closed area', {area: {is_open: false, unlock_at: null}}, 'AREA_CLOSED'],
  ['future area', {area: {is_open: true, unlock_at: '2999-01-01T00:00:00Z'}}, 'AREA_CLOSED'],
  ['no results', {results: []}, 'NO_INVESTIGATION_RESULT']
]) {
  test(`${name}: no changes, rollback and release`, async () => {
    const f = fixture(overrides); const before = clone(f.state());
    await assert.rejects(f.repository.investigate('7', '1', key), error => error.code === code);
    assert.deepEqual(f.state(), before); assert.equal(f.calls.at(-1).sql, 'rollback'); assert.equal(f.released(), 1);
  });
}

test('unique discovery increments global progress once; repeat still pays reward and AP', async () => {
  const f = fixture({results: [unique], rewards: [reward]});
  const first = await f.repository.investigate('7', '1', key);
  const second = await f.repository.investigate('7', '1', key2);
  assert.equal(first.firstDiscovery, true); assert.equal(second.firstDiscovery, false);
  assert.equal(first.area.investigation_rate, 15); assert.equal(second.area.investigation_rate, 15);
  assert.equal(second.ap, 1); assert.equal(second.rewards[0].inventoryQuantity, 4);
  assert.equal(first.clue.title, '단서'); assert.deepEqual(f.state().discoveries, ['2']);
  assert.equal(f.calls.filter(call => call.sql.startsWith('update public.area')).length, 1);
});

test('unique previously discovered by any character never increases progress', async () => {
  const f = fixture({results: [unique], discoveries: ['2']});
  const result = await f.repository.investigate('7', '1', key);
  assert.equal(result.firstDiscovery, false); assert.equal(result.area.investigation_rate, 0);
});

test('progress capped at 100', async () => {
  const f = fixture({results: [unique], area: {id: '1', is_open: true, unlock_at: null, investigation_rate: '95'}});
  assert.equal((await f.repository.investigate('7', '1', key)).area.investigation_rate, 100);
});

test('duplicate request does not consume AP or pay reward twice', async () => {
  const f = fixture({rewards: [reward]});
  await f.repository.investigate('7', '1', key); const before = clone(f.state());
  await assert.rejects(f.repository.investigate('7', '1', key), error => error.code === 'DUPLICATE_REQUEST');
  assert.deepEqual(f.state(), before);
});

test('last AP succeeds once and retry remains duplicate even with zero AP', async () => {
  const f = fixture();
  f.state().character.ap = 1;
  assert.equal((await f.repository.investigate('7', '1', key)).ap, 0);
  await assert.rejects(f.repository.investigate('7', '1', key), error => error.code === 'DUPLICATE_REQUEST');
  await assert.rejects(f.repository.investigate('7', '1', key2), error => error.code === 'NOT_ENOUGH_AP');
  assert.equal(f.state().logs.length, 1);
});

for (const [name, options] of [
  ['concurrent request key collision at log', {duplicateAtLog: true}],
  ['reward write failure', {failAt: 'insert into public.inventory'}],
  ['action log failure', {failAt: 'insert into public.action_log'}],
  ['clue lookup failure', {failAt: 'select * from public.clue'}]
]) {
  test(`${name}: AP, discovery, progress, inventory and log all rolled back`, async () => {
    const f = fixture({results: [unique], rewards: [reward]}, options); const before = clone(f.state());
    await assert.rejects(f.repository.investigate('7', '1', key), error =>
      options.duplicateAtLog ? error.code === 'DUPLICATE_REQUEST' : error.message === 'injected failure');
    assert.deepEqual(f.state(), before); assert.equal(f.calls.at(-1).sql, 'rollback'); assert.equal(f.released(), 1);
  });
}

test('inactive reward item rolls back investigation', async () => {
  const f = fixture({rewards: [reward], items: [{id: '3', is_active: false}]}); const before = clone(f.state());
  await assert.rejects(f.repository.investigate('7', '1', key), error => error.code === 'REWARD_UNAVAILABLE');
  assert.deepEqual(f.state(), before);
});

test('reward probability can skip payment and ordinary result still consumes AP', async () => {
  const f = fixture({rewards: [{...reward, probability: '25'}]}, {random: () => 0.5});
  const result = await f.repository.investigate('7', '1', key);
  assert.deepEqual(result.rewards, []); assert.equal(result.ap, 2);
});

test('weighted selection and reward thresholds are deterministic and validate RNG', () => {
  const results = [{id: 1, weight: 1}, {id: 2, weight: 3}];
  assert.equal(chooseResult(results, () => 0).id, 1);
  assert.equal(chooseResult(results, () => 0.2499).id, 1);
  assert.equal(chooseResult(results, () => 0.25).id, 2);
  assert.equal(chooseResult(results, () => 0.9999).id, 2);
  assert.equal(chooseResult([]), null);
  assert.equal(winsReward(0), false); assert.equal(winsReward(100), true);
  assert.equal(winsReward('25', () => 0.2499), true); assert.equal(winsReward('25', () => 0.25), false);
  assert.throws(() => chooseResult(results, () => 1));
  assert.throws(() => chooseResult([{weight: 0}]));
});

test('area listing filters using DB time and active ownership; keeps bigint ids as strings', async () => {
  const areas = [{id: '9007199254740993', is_open: true, investigation_rate: 15}];
  const repository = createInvestigationRepository({async query(sql, params) {
    assert.match(sql, /u.is_active and c.is_active/); assert.match(sql, /a.is_open/);
    assert.match(sql, /a.unlock_at<=statement_timestamp\(\)/); assert.match(sql, /a.id::text/);
    assert.deepEqual(params, ['7']); return rows([{character_id: '10', status: 'ALIVE', areas}]);
  }});
  assert.deepEqual(await repository.getInvestigationAreas('7'), areas);
});

test('service validates body, UUID and bigint area id without calling repository', async () => {
  const service = createInvestigationService({investigate() { throw new Error('must not call'); }, getInvestigationAreas() {}});
  for (const areaId of ['0', '-1', '1.2', '9223372036854775808', 'x']) {
    await assert.rejects(service.investigate('7', areaId, {requestKey: key}), error => error.code === 'INVALID_AREA_ID');
  }
  for (const body of [null, [], {requestKey: key, userId: '8'}, {requestKey: 'invalid'}, {}]) {
    await assert.rejects(service.investigate('7', '1', body), error => error.status === 400);
  }
});

test('HTTP routes require auth, preserve envelope and accept only server-owned user identity', async t => {
  const repository = createMemoryRepository();
  const calls = [];
  repository.getInvestigationAreas = async userId => { calls.push(userId); return [{id: '1'}]; };
  repository.investigate = async (...args) => { calls.push(args); return {result: {id: '2'}, rewards: [], clue: null, firstDiscovery: false, area: {id: '1', investigation_rate: 0}, ap: 9}; };
  const server = createApp({origin: 'http://localhost:3000', loginKey: 'test-only-passphrase', userId: '1'}, repository).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  assert.equal((await fetch(base + '/investigation/areas')).status, 401);
  assert.equal((await fetch(base + '/investigation/1', {method: 'POST'})).status, 401);
  const login = await fetch(base + '/auth/dev/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: 'test-only-passphrase'})});
  const token = (await login.json()).data.token;
  const headers = {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'};
  const list = await fetch(base + '/investigation/areas', {headers});
  assert.deepEqual((await list.json()).data, {areas: [{id: '1'}]});
  const response = await fetch(base + '/investigation/1', {method: 'POST', headers, body: JSON.stringify({requestKey: key})});
  const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.ok, true); assert.ok(result.requestId); assert.equal(result.data.ap, 9);
  assert.deepEqual(calls, ['1', ['1', '1', key]]);
  delete repository.investigate;
  assert.equal((await fetch(base + '/investigation/areas', {headers})).status, 501);
});
