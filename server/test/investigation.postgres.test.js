import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../src/config/env.js';
import {createPool} from '../src/db/pool.js';
import {createInvestigationRepository} from '../src/modules/investigation/repository.js';

// Opt-in: fixture rows stay inside an outer transaction and are rolled back.
// PostgreSQL identity sequences can advance even though no rows are retained.
test('PostgreSQL investigation integration (all fixture rows rolled back)', {
  skip: process.env.RUN_INVESTIGATION_DB_TESTS !== '1'
}, async t => {
  const pool = createPool(loadConfig());
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("set local lock_timeout='3s'");
    const character = (await client.query(
      `insert into public.game_character(name,hunter_grade,atk,def,agi,ap)
       values ('조사 API rollback 검증','B',10,10,10,5) returning *`
    )).rows[0];
    const user = (await client.query(
      "insert into public.auth_user(character_id,role) values ($1,'USER') returning id", [character.id]
    )).rows[0];
    const area = (await client.query(
      "insert into public.area(name,is_open) values ('조사 rollback 검증',true) returning *"
    )).rows[0];
    const item = (await client.query(
      "insert into public.item(name,category) values ('검증 보상','ETC') returning id"
    )).rows[0];
    const clue = (await client.query(
      "insert into public.clue(area_id,title,content) values ($1,'검증 단서','단서 내용') returning id", [area.id]
    )).rows[0];
    const result = (await client.query(
      `insert into public.investigation_result(area_id,result_grade,result_text,is_unique,investigation_rate_value,clue_id)
       values ($1,'NORMAL','검증 결과',true,15,$2) returning id`, [area.id, clue.id]
    )).rows[0];
    await client.query(
      'insert into public.investigation_reward(investigation_result_id,item_id,quantity) values ($1,$2,2)', [result.id, item.id]
    );

    let failLog = false;
    // Repository transaction boundaries become savepoints only in this test.
    const adapter = {
      async query(sql, params) {
        if (sql === 'begin') return client.query('savepoint investigation_call');
        if (sql === 'commit') return client.query('release savepoint investigation_call');
        if (sql === 'rollback') {
          await client.query('rollback to savepoint investigation_call');
          return client.query('release savepoint investigation_call');
        }
        if (failLog && sql.includes('insert into public.action_log')) throw new Error('injected log failure');
        return client.query(sql, params);
      },
      release() {}
    };
    const repository = createInvestigationRepository({query: (...args) => client.query(...args), connect: async () => adapter}, {random: () => 0});
    const requestKey = randomUUID();

    await t.test('actual area list, first discovery, reward, clue and AP', async () => {
      assert.ok((await repository.getInvestigationAreas(user.id)).some(row => row.id === area.id));
      const first = await repository.investigate(user.id, area.id, requestKey);
      assert.equal(first.firstDiscovery, true); assert.equal(first.area.investigation_rate, 15);
      assert.equal(first.ap, 4); assert.equal(first.clue.id, clue.id); assert.equal(first.rewards[0].quantity, 2);
      const inventory = await client.query('select quantity from public.inventory where character_id=$1 and item_id=$2', [character.id, item.id]);
      assert.equal(inventory.rows[0].quantity, 2);
    });
    await t.test('repeat unique keeps progress and pays reward again', async () => {
      const repeated = await repository.investigate(user.id, area.id, randomUUID());
      assert.equal(repeated.firstDiscovery, false); assert.equal(repeated.area.investigation_rate, 15);
      assert.equal(repeated.ap, 3); assert.equal(repeated.rewards[0].inventoryQuantity, 4);
    });
    await t.test('duplicate key rejected without further charge', async () => {
      await assert.rejects(repository.investigate(user.id, area.id, requestKey), error => error.code === 'DUPLICATE_REQUEST');
      const r = await client.query('select ap from public.game_character where id=$1', [character.id]);
      assert.equal(r.rows[0].ap, 3);
    });
    await t.test('different character shares global discovery and still receives reward', async () => {
      const otherCharacter = (await client.query(
        `insert into public.game_character(name,hunter_grade,atk,def,agi,ap)
         values ('다른 조사 검증 캐릭터','B',10,10,10,2) returning id`
      )).rows[0];
      const otherUser = (await client.query(
        "insert into public.auth_user(character_id,role) values ($1,'USER') returning id", [otherCharacter.id]
      )).rows[0];
      const repeated = await repository.investigate(otherUser.id, area.id, randomUUID());
      assert.equal(repeated.firstDiscovery, false); assert.equal(repeated.area.investigation_rate, 15);
      assert.equal(repeated.ap, 1); assert.equal(repeated.rewards[0].inventoryQuantity, 2);
      const discoveries = await client.query('select character_id from public.unique_discovery where investigation_result_id=$1', [result.id]);
      assert.deepEqual(discoveries.rows, [{character_id: character.id}]);
    });
    await t.test('actual log failure rolls back AP, inventory, discovery and progress', async () => {
      const fresh = (await client.query(
        `insert into public.investigation_result(area_id,result_grade,result_text,is_unique,investigation_rate_value)
         values ($1,'NORMAL','실패 검증',true,10) returning id`, [area.id]
      )).rows[0];
      await client.query('update public.investigation_result set is_active=false where id=$1', [result.id]);
      await client.query('insert into public.investigation_reward(investigation_result_id,item_id,quantity) values ($1,$2,2)', [fresh.id, item.id]);
      failLog = true;
      await assert.rejects(repository.investigate(user.id, area.id, randomUUID()), /injected log failure/);
      failLog = false;
      assert.equal((await client.query('select ap from public.game_character where id=$1', [character.id])).rows[0].ap, 3);
      assert.equal(Number((await client.query('select investigation_rate from public.area where id=$1', [area.id])).rows[0].investigation_rate), 15);
      assert.equal((await client.query('select quantity from public.inventory where character_id=$1 and item_id=$2', [character.id, item.id])).rows[0].quantity, 4);
      assert.equal((await client.query('select id from public.unique_discovery where investigation_result_id=$1', [fresh.id])).rowCount, 0);
      assert.equal((await client.query('select id from public.action_log where character_id=$1', [character.id])).rowCount, 2);
    });
  } finally {
    await client.query('rollback');
    client.release();
    await pool.end();
  }
});
