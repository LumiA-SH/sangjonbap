import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresRepository} from '../src/modules/character/repository.js';
import {createInventoryRepository} from '../src/modules/inventory/repository.js';

const character = {
  id: '9007199254740993', hp: 50, max_hp: 100, blood: 30, max_blood: 100,
  ap: 5, max_ap: 10, currency: 20, status: 'ALIVE', death_count: 2
};
const item = {id: '8', name: '식량', transferable: true};
const rows = values => ({rowCount: values.length, rows: values});

// A scripted pg client fails on unexpected queries and verifies lock order,
// parameters and transaction completion without touching the live game DB.
function fixture(steps) {
  let released = false;
  const client = {
    async query(sql, params) {
      const step = steps.shift();
      assert.ok(step, `Unexpected query: ${sql}`);
      assert.match(sql.replace(/\s+/g, ' ').trim(), step.sql);
      if (step.params) assert.deepEqual(params, step.params);
      if (step.check) step.check(params);
      if (step.error) throw step.error;
      return step.result || rows([]);
    },
    release() { released = true; }
  };
  return {
    pool: {connect: async () => client},
    done() { assert.equal(steps.length, 0); assert.equal(released, true); }
  };
}

const begin = () => ({sql: /^begin$/});
const end = command => ({sql: new RegExp(`^${command}$`)});
const own = (value = character) => ({
  sql: /^select c\.(?:\*|id).*where u.id=\$1 and u.is_active and c.is_active for update of u,c$/,
  params: ['7'], result: rows(value ? [value] : [])
});
const lockItem = (value = item) => ({
  sql: /^select .*from public.item where id=\$1 and is_active for update$/,
  params: ['8'], result: rows(value ? [value] : [])
});
function logRecord(sqlParams) {
  const [characterId, adminUserId, category, actionType, targetType, targetId,
    description, detail, requestKey] = sqlParams;
  return {characterId, adminUserId, category, actionType, targetType, targetId,
    description, detail: JSON.parse(detail), requestKey};
}
const snapshot = c => Object.fromEntries(
  ['hp', 'blood', 'ap', 'currency', 'status', 'death_count'].map(key => [key, c[key]])
);

for (const scenario of [
  {name: 'upper and lower bounds', changes: [100, 100, -50, -100], expected: [100, 100, 0, 0, 'ALIVE', 2]},
  {name: 'death wins over zero blood', changes: [-50, -30, 0, 0], expected: [0, 0, 5, 20, 'DEAD', 3]},
  {name: 'zero blood causes near death', changes: [0, -30, 0, 0], expected: [50, 0, 5, 20, 'NEAR_DEATH', 2]},
  {name: 'dead stays dead without increment', before: {hp: 0, status: 'DEAD'}, changes: [0, 0, 0, 0], expected: [0, 30, 5, 20, 'DEAD', 2]},
  {name: 'healing does not revive dead', before: {hp: 0, status: 'DEAD'}, changes: [20, 0, 0, 0], expected: [20, 30, 5, 20, 'DEAD', 2]},
  {name: 'blood recovery keeps near death', before: {blood: 0, status: 'NEAR_DEATH'}, changes: [0, 20, 0, 0], expected: [50, 20, 5, 20, 'NEAR_DEATH', 2]}
]) {
  test(`resources: ${scenario.name}; exact action detail and transaction`, async () => {
    const before = {...character, ...scenario.before};
    const changes = Object.fromEntries(['hp', 'blood', 'ap', 'currency'].map((key, i) => [key, scenario.changes[i]]));
    const after = {...before, ...Object.fromEntries(['hp', 'blood', 'ap', 'currency', 'status', 'death_count'].map((key, i) => [key, scenario.expected[i]]))};
    const f = fixture([
      begin(), own(before),
      {sql: /^update public.game_character .*where id=\$7 returning \*$/, params: [...scenario.expected, character.id], result: rows([after])},
      {sql: /^insert into public.action_log /, check(params) {
        assert.deepEqual(logRecord(params), {
          characterId: character.id, adminUserId: null, category: 'CHARACTER', actionType: 'RESOURCE_CHANGE',
          targetType: null, targetId: null, description: '검증', requestKey: null,
          detail: {reason: '검증', requested: changes, before: snapshot(before), after: snapshot(after)}
        });
      }}, end('commit')
    ]);
    assert.deepEqual(await createPostgresRepository(f.pool).changeResources('7', changes, '검증'), after);
    f.done();
  });
}

test('resources: missing character rolls back', async () => {
  const f = fixture([begin(), own(null), end('rollback')]);
  assert.equal(await createPostgresRepository(f.pool).changeResources('7', {}, '검증'), null);
  f.done();
});

test('resources: log failure rolls back resource update and releases client', async () => {
  const failure = new Error('log failed');
  const f = fixture([begin(), own(),
    {sql: /^update public.game_character /, result: rows([character])},
    {sql: /^insert into public.action_log /, error: failure}, end('rollback')]);
  await assert.rejects(createPostgresRepository(f.pool).changeResources('7', {hp: 0, blood: 0, ap: 0, currency: 0}, '검증'), error => error === failure);
  f.done();
});

const inventoryRead = quantity => ({
  sql: /^select id,quantity from public.inventory where character_id=\$1 and item_id=\$2 for update$/,
  params: [character.id, '8'], result: rows(quantity === null ? [] : [{id: '9', quantity}])
});
const storageRead = quantity => ({
  sql: /^select item_id,quantity from public.storage where item_id=\$1 for update$/,
  params: ['8'], result: rows(quantity === null ? [] : [{item_id: '8', quantity}])
});
function movementSteps(method, emptyDestination) {
  return method === 'deposit' ? [
    inventoryRead(2), {sql: /^update public.inventory /, params: [0, '9']},
    storageRead(emptyDestination ? null : 3), emptyDestination
      ? {sql: /^insert into public.storage /, params: ['8', 2]}
      : {sql: /^update public.storage /, params: [5, '8']}
  ] : [
    storageRead(2), {sql: /^update public.storage /, params: [0, '8']},
    inventoryRead(emptyDestination ? null : 3), emptyDestination
      ? {sql: /^insert into public.inventory /, params: [character.id, '8', 2]}
      : {sql: /^update public.inventory /, params: [5, '9']}
  ];
}

for (const method of ['deposit', 'withdraw']) {
  for (const emptyDestination of [false, true]) {
    test(`${method}: ${emptyDestination ? 'new' : 'existing'} destination, locks and log preserved`, async () => {
      const deposit = method === 'deposit';
      const destinationBefore = emptyDestination ? 0 : 3;
      const inventoryQuantity = deposit ? 0 : destinationBefore + 2;
      const storageQuantity = deposit ? destinationBefore + 2 : 0;
      const f = fixture([begin(), own(), lockItem(), ...movementSteps(method, emptyDestination),
        {sql: /^insert into public.action_log /, check(params) {
          assert.deepEqual(logRecord(params), {
            characterId: character.id, adminUserId: null, category: 'INVENTORY',
            actionType: deposit ? 'STORAGE_DEPOSIT' : 'STORAGE_WITHDRAW', targetType: 'ITEM', targetId: '8',
            description: deposit ? '식량 2개를 공용창고에 보관했습니다.' : '식량 2개를 공용창고에서 가져왔습니다.',
            detail: {item_id: '8', item_name: '식량', quantity: 2,
              inventory_before: deposit ? 2 : destinationBefore, inventory_after: inventoryQuantity,
              storage_before: deposit ? destinationBefore : 2, storage_after: storageQuantity}, requestKey: 'request-123'
          });
        }}, end('commit')]);
      assert.deepEqual(await createInventoryRepository(f.pool)[method]('7', '8', 2, 'request-123'),
        {type: 'OK', item, quantity: 2, inventoryQuantity, storageQuantity});
      f.done();
    });
  }

  for (const [name, steps, type] of [
    ['missing character', [own(null)], 'CHARACTER_NOT_FOUND'],
    ['missing item', [own(), lockItem(null)], 'ITEM_NOT_FOUND'],
    ['nontransferable item', [own(), lockItem({...item, transferable: false})], 'NOT_TRANSFERABLE'],
    ['insufficient source', [own(), lockItem(), method === 'deposit' ? inventoryRead(1) : storageRead(1)],
      method === 'deposit' ? 'NOT_ENOUGH_INVENTORY' : 'NOT_ENOUGH_STORAGE']
  ]) {
    test(`${method}: ${name} rolls back without log`, async () => {
      const f = fixture([begin(), ...steps, end('rollback')]);
      assert.deepEqual(await createInventoryRepository(f.pool)[method]('7', '8', 2, 'request-123'), {type});
      f.done();
    });
  }

  for (const duplicate of [true, false]) {
    test(`${method}: ${duplicate ? 'duplicate request' : 'log error'} rolls back both quantity writes`, async () => {
      const failure = Object.assign(new Error('write failed'), {
        code: '23505', constraint: duplicate ? 'action_log_request_key_key' : 'another_constraint'
      });
      const f = fixture([begin(), own(), lockItem(), ...movementSteps(method, false),
        {sql: /^insert into public.action_log /, error: failure}, end('rollback')]);
      const result = createInventoryRepository(f.pool)[method]('7', '8', 2, 'request-123');
      if (duplicate) assert.deepEqual(await result, {type: 'DUPLICATE_REQUEST'});
      else await assert.rejects(result, error => error === failure);
      f.done();
    });
  }
}
