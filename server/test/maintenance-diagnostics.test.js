import test from 'node:test';
import assert from 'node:assert/strict';
import {createMaintenanceDiagnostics} from '../src/modules/maintenance/diagnostics.js';
import {createIsolatedPool} from './isolated-pool.js';

test('diagnostic uses only fixed read-only SQL and destroys connection', async () => {
    const sql = []; let released;
    const diagnose = createMaintenanceDiagnostics({connect: async () => ({query: async s => {sql.push(s); return {rows: [{connected: 1, read_only: 'on'}]};}, release: value => {released = value;}})});
    assert.equal((await diagnose()).readOnly, true); assert.equal(released, true);
    assert.equal(sql[0], 'BEGIN READ ONLY'); assert.equal(sql.at(-1), 'ROLLBACK'); assert.equal(sql.length, 5);
});
for (const phase of ['connect', 'query']) test('diagnostic sanitizes ' + phase + ' failure and timeout', async () => {
    let released = false;
    const diagnose = createMaintenanceDiagnostics({connect: async () => {if (phase === 'connect') throw new Error('private connection string'); return {query: async () => {throw new Error('private credentials');}, release: () => {released = true;}};}});
    await assert.rejects(diagnose(), e => e.code === 'MAINTENANCE_DB_UNAVAILABLE' && !/private/.test(e.message));
    assert.equal(released, phase === 'query');
});
test('isolated PostgreSQL read-only diagnostic', {skip: !process.env.RUN_MAINTENANCE_PG_TESTS}, async () => {
    const pool = createIsolatedPool(); try {        
const result = await createMaintenanceDiagnostics(pool)(); assert.equal(result.connected, true); assert.equal(result.readOnly, true); assert.ok(result.durationMs >= 0);
        const slow = {async connect() {const c = await pool.connect(); return {query: q => c.query(q.startsWith('SELECT 1 AS') ? 'SELECT pg_sleep(10)' : q), release: destroy => c.release(destroy)};} };
        const started = performance.now(); await assert.rejects(createMaintenanceDiagnostics(slow)(), {code: 'MAINTENANCE_DB_UNAVAILABLE'});
        assert.ok(performance.now() - started < 6000, 'server statement timeout must bound the query');    
} finally {await pool.end();}
});


test('isolated Cron preview, read-only enforcement, bounded overlapping expiry batches', {skip: !process.env.RUN_MAINTENANCE_PG_TESTS}, async () => {
    const {readFileSync} = await import('node:fs');
    const {randomUUID} = await import('node:crypto');
    const {createBattleRepository} = await import('../src/modules/battle/repository.js');
    const raw = createIsolatedPool(), schema = 'maintenance_' + randomUUID().replaceAll('-', '');
    const rewrite = q => q.replaceAll('public.', schema + '.');
    const pool = {query: (q, p) => raw.query(rewrite(q), p), async connect() {const c = await raw.connect(); return {query: (q, p) => c.query(rewrite(q), p), release: () => c.release()};} };
    try {
        const preview = await raw.query(readFileSync(new URL('../scripts/maintenance-cron.draft.sql', import.meta.url), 'utf8'));
        assert.equal(preview.rowCount, 4); assert.equal(preview.rows[0].schedule, '0 15 * * *');
        for (const r of preview.rows) {assert.match(r.proposed_sql, /maintenance_control./); assert.match(r.proposed_sql, /active := false/);}
        await raw.query('create schema ' + schema);
        for (const table of ['game_character', 'daily_reset_state', 'battle', 'battle_log', 'action_log']) await raw.query('create table ' + schema + '.' + table + ' (like public.' + table + ' including all)');
        await pool.query('insert into public.daily_reset_state(singleton) values(true)');
        const check = await raw.connect(); try {await check.query('begin read only'); await assert.rejects(check.query('insert into ' + schema + '.daily_reset_state(singleton) values(false)'), {code: '25006'});} finally {await check.query('rollback'); check.release();}
        for (let i = 0; i < 12; i++) {
            const {rows: [c]} = await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,hp,blood,ap,currency) values('batch','B',12,12,12,70,35,2,5) returning id");
            await pool.query("insert into public.battle(character_id,monster_id,area_id,character_hp,monster_hp,monster_max_hp,monster_atk,monster_def,monster_agi,battle_status,started_at) values($1,1,1,70,10,10,1,1,1,'ACTIVE',clock_timestamp()-interval '25 hours')", [c.id]);
        }
        const repo = createBattleRepository(pool);
        await Promise.all([repo.expireBattles({limit: 10}), repo.expireBattles({limit: 10})]);
        await repo.expireBattles({limit: 10});
        assert.equal((await pool.query("select count(*)::int n from public.battle where battle_status='DEFEAT' and end_reason='TIMEOUT'")).rows[0].n, 12);
        assert.equal((await pool.query('select count(*)::int n from public.battle_log')).rows[0].n, 12);
        assert.equal((await pool.query('select count(*)::int n from public.action_log')).rows[0].n, 12);
        assert.equal((await pool.query('select count(*)::int n from public.game_character where hp=70 and blood=35 and ap=2 and currency=5')).rows[0].n, 12);
        assert.equal(await repo.expireBattles({limit: 10}), 0);
    } finally {await raw.query('drop schema if exists ' + schema + ' cascade'); await raw.end();}
});
