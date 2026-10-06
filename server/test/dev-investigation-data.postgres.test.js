import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../src/config/env.js';
import {createPool} from '../src/db/pool.js';
import {manageDevInvestigationData} from '../scripts/dev-investigation-data.js';

test('DEV seed is idempotent; cleanup is scoped and can be rolled back', {
  skip: process.env.RUN_INVESTIGATION_DB_TESTS !== '1'
}, async () => {
  const pool = createPool(loadConfig());
  const client = await pool.connect();
  try {
    await client.query('begin');
    const first = await manageDevInvestigationData(client);
    const second = await manageDevInvestigationData(client);
    assert.deepEqual(second, first);
    assert.equal(first.areaIds.length, 2);
    assert.equal(first.resultIds.length, 2);
    const counts = (await client.query(`select
      (select count(*)::int from public.investigation_result where area_id=any($1::bigint[])) as results,
      (select count(*)::int from public.investigation_reward where investigation_result_id=any($2::bigint[])) as rewards`,
    [first.areaIds, first.resultIds])).rows[0];
    assert.deepEqual(counts, {results: 2, rewards: 2});
    const unrelated = (await client.query('select count(*)::int as count from public.area where not(id=any($1::bigint[]))', [first.areaIds])).rows[0].count;
    await client.query('savepoint cleanup_check');
    await manageDevInvestigationData(client, {remove: true});
    assert.equal((await client.query('select id from public.area where id=any($1::bigint[])', [first.areaIds])).rowCount, 0);
    assert.equal((await client.query('select id from public.item where id=$1', [first.itemId])).rowCount, 0);
    assert.equal((await client.query('select count(*)::int as count from public.area')).rows[0].count, unrelated);
    await client.query('rollback to savepoint cleanup_check');
    assert.deepEqual(await manageDevInvestigationData(client), first);
  } finally {
    await client.query('rollback');
    client.release();
    await pool.end();
  }
});
