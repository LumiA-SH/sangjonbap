import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool as createPool} from './isolated-pool.js';
import {createDailyResetRepository, catchUpDailyResets} from '../src/modules/daily/repository.js';
import {changeCharacterResources, writeActionLog} from '../src/shared/game.js';
import {kstDate} from '../src/modules/daily/date.js';

test('daily transaction engine: real PostgreSQL isolated history and fixture-only mutations', {
    skip: process.env.RUN_DAILY_DB_TESTS !== '1'
}, async t => {
    const pool = createPool();
    const schema = 'dev_daily_' + randomUUID().replaceAll('-', '');
    const ids = [];
    let created = false;
    // Dedicated schema provides independent state for concurrency tests. No
    // public reset state/history or existing characters/settings are modified.
    const rewrite = sql => sql.replaceAll('public.daily_reset_', `${schema}.daily_reset_`)
        .replaceAll('public.system_config', `${schema}.system_config`);
    const scoped = {query: (sql, params) => pool.query(rewrite(sql), params), async connect() {
        const client = await pool.connect();
        return {query: (sql, params) => client.query(rewrite(sql), params), release: () => client.release()};
    }};
    const repo = createDailyResetRepository(scoped);
    try {
        await pool.query(`create schema ${schema}`);
        created = true;
        await pool.query(`create table ${schema}.daily_reset_state (like public.daily_reset_state including all)`);
        await pool.query(`create table ${schema}.daily_reset_run (like public.daily_reset_run including all)`);
        await pool.query(`create table ${schema}.system_config as select config_key,config_value from public.system_config where config_key='daily_blood_decay'`);
        await scoped.query('insert into public.daily_reset_state(singleton) values(true)');
        for (const label of ['alive', 'zero-hp', 'near-death', 'dead']) {
            ids.push((await pool.query(`insert into public.game_character(name,hunter_grade,atk,def,agi)
                values ($1,'B',10,10,10) returning id`, [`DEV daily fixture ${schema} ${label}`])).rows[0].id);
        }
        const {today} = await repo.getStatus();
        const previous = offset => new Date(Date.parse(today + 'T00:00:00Z') - offset * 86400000).toISOString().slice(0, 10);
        const reset = async start => {
            await scoped.query('delete from public.daily_reset_run');
            await scoped.query('update public.daily_reset_state set start_date=$1,last_completed_date=null', [start]);
            await scoped.query("update public.system_config set config_value='10'::jsonb");
            await pool.query('delete from public.action_log where character_id=any($1::bigint[])', [ids]);
            await pool.query(`update public.game_character set hp=50,blood=35,ap=1,daily_meal_count=3,
                daily_training_done=true,status='ALIVE',death_count=0 where id=any($1::bigint[])`, [ids]);
        };
        const get = async index => (await pool.query('select * from public.game_character where id=$1', [ids[index]])).rows[0];
        // Explicit TEST policy, NOT a production eligibility/catch-up policy.
        const applyFixtureDay = async ({client, day, currentSettings}) => {
            const result = await client.query('select * from public.game_character where id=any($1::bigint[]) order by id for update', [ids]);
            for (const before of result.rows) {
                const after = await changeCharacterResources(client, before, {
                    blood: before.status === 'DEAD' ? 0 : -currentSettings.daily_blood_decay,
                    ap: Number(before.max_ap) - Number(before.ap)
                });
                await client.query('update public.game_character set daily_meal_count=0,daily_training_done=false where id=$1', [before.id]);
                await writeActionLog(client, {characterId: before.id, category: 'CHARACTER', actionType: 'DAILY_RESET_TEST',
                    description: 'Isolated daily foundation test', detail: {day, before, after}});
            }
            return {testPolicy: true, bloodDecay: currentSettings.daily_blood_decay};
        };
        await t.test('baseline NULL and missing policy hold without effects', async () => {
            assert.equal((await repo.getStatus()).nextDate, null);
            await assert.rejects(repo.runNextDay(), {code: 'DAILY_RESET_POLICY_HOLD'});
            await assert.rejects(repo.runNextDay(applyFixtureDay), {code: 'DAILY_RESET_START_HOLD'});
        });
        await t.test('DB uses KST independent of session timezone', async () => {
            assert.equal(today, kstDate(new Date()));
            const client = await scoped.connect();
            try {
                await client.query('begin');
                await client.query("set local time zone 'America/Los_Angeles'");
                const status = await createDailyResetRepository({query: (...args) => client.query(...args)}).getStatus();
                assert.equal(status.today, today);
            } finally { await client.query('rollback'); client.release(); }
        });
        await t.test('one missed date and duplicate execution apply only once', async () => {
            await reset(today);
            assert.equal((await repo.runNextDay(applyFixtureDay)).date, today);
            assert.equal(await repo.runNextDay(applyFixtureDay), null);
            const character = await get(0);
            assert.equal(character.blood, 25);
            assert.equal(character.ap, character.max_ap);
            assert.equal(character.daily_meal_count, 0);
            assert.equal(character.daily_training_done, false);
        });
        await t.test('three missed dates are ordered and each deducts ten', async () => {
            await reset(previous(2));
            const result = await catchUpDailyResets(repo, applyFixtureDay);
            assert.deepEqual(result.map(entry => entry.date), [previous(2), previous(1), today]);
            assert.equal((await get(0)).blood, 5);
        });
        await t.test('two concurrent executors complete same day exactly once', async () => {
            await reset(today);
            const result = await Promise.all([repo.runNextDay(applyFixtureDay), repo.runNextDay(applyFixtureDay)]);
            assert.equal(result.filter(Boolean).length, 1);
            assert.equal((await get(0)).blood, 25);
            assert.equal((await scoped.query('select * from public.daily_reset_run')).rowCount, 1);
        });
        await t.test('failure after mutations rolls back history, resources and logs; retry succeeds', async () => {
            await reset(today);
            await assert.rejects(repo.runNextDay(async context => { await applyFixtureDay(context); throw new Error('injected failure'); }), /injected failure/);
            assert.equal((await get(0)).blood, 35);
            assert.equal((await scoped.query('select * from public.daily_reset_run')).rowCount, 0);
            assert.equal((await pool.query('select * from public.action_log where character_id=any($1::bigint[])', [ids])).rowCount, 0);
            assert.equal((await repo.getStatus()).last_completed_date, null);
            await repo.runNextDay(applyFixtureDay);
            assert.equal((await get(0)).blood, 25);
        });
        await t.test('shared state transitions remain correct under explicit fixture policy', async () => {
            await reset(today);
            await pool.query('update public.game_character set hp=0 where id=$1', [ids[1]]);
            await pool.query('update public.game_character set blood=10 where id=$1', [ids[2]]);
            await pool.query("update public.game_character set hp=0,blood=0,status='DEAD' where id=$1", [ids[3]]);
            await repo.runNextDay(applyFixtureDay);
            assert.equal((await get(1)).status, 'DEAD');
            assert.equal((await get(1)).death_count, 1);
            assert.equal((await get(2)).status, 'NEAR_DEATH');
            assert.equal((await get(3)).status, 'DEAD');
            assert.equal((await get(3)).death_count, 0);
        });
        await t.test('invalid and missing settings prevent any date completion', async () => {
            await reset(today);
            await scoped.query(`update public.system_config set config_value='"10"'::jsonb`);
            await assert.rejects(repo.runNextDay(applyFixtureDay), {code: 'SYSTEM_CONFIG_INVALID'});
            await scoped.query('delete from public.system_config');
            await assert.rejects(repo.runNextDay(applyFixtureDay), {code: 'SYSTEM_CONFIG_MISSING'});
            assert.equal((await get(0)).blood, 35);
            assert.equal((await scoped.query('select * from public.daily_reset_run')).rowCount, 0);
        });
    } finally {
        try {
            await pool.query('delete from public.action_log where character_id=any($1::bigint[])', [ids]);
            await pool.query('delete from public.game_character where id=any($1::bigint[])', [ids]);
            if (created) await pool.query(`drop schema ${schema} cascade`);
        } finally { await pool.end(); }
    }
});
