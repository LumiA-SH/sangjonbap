import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createIsolatedPool} from './isolated-pool.js';
import {createBattleRepository} from '../src/modules/battle/repository.js';

test('maintenance retries and Cron SQL with isolated pg_net/Vault stubs', {skip: !process.env.RUN_MAINTENANCE_PG_TESTS}, async t => {
    const raw = createIsolatedPool(), base = 'cron_' + randomUUID().replaceAll('-', '');
    const rewrite = q => q.replaceAll('public.', base + '.').replaceAll('maintenance_control', base + '_control').replaceAll('vault.', base + '_vault.').replaceAll('net.', base + '_net.');
    let failIds = new Set();
    const pool = {query: (q, p) => raw.query(rewrite(q), p), async connect() {const c = await raw.connect(); return {release: () => c.release(), async query(q, p) {if (q.includes('insert into public.battle_log') && failIds.has(String(p[0]))) {const e = new Error('sensitive text must not be persisted'); e.code = '57014'; throw e;} return c.query(rewrite(q), p);} };} };
    try {
        await raw.query('create schema ' + base); await raw.query('create schema ' + base + '_vault'); await raw.query('create schema ' + base + '_net');
        for (const table of ['game_character', 'daily_reset_state', 'battle', 'battle_log', 'action_log']) await raw.query('create table ' + base + '.' + table + '(like public.' + table + ' including all)');
        await pool.query('insert into public.daily_reset_state(singleton) values(true)');
        await raw.query('create table ' + base + '_vault.decrypted_secrets(name text,decrypted_secret text)');
        await raw.query('insert into ' + base + "_vault.decrypted_secrets values('maintenance_secret',$1)", ['isolated-secret-'.repeat(4)]);
        await raw.query('create table ' + base + '_net.http_request_queue(id bigint)');
        await raw.query('create table ' + base + '_net._http_response(id bigint primary key,status_code integer,timed_out boolean,content text)');
        await raw.query('create table ' + base + '_net.sent(id bigint generated always as identity primary key,url text,valid_header boolean,timeout_ms integer)');
        await raw.query('create function ' + base + "_net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$ insert into " + base + "_net.sent(url,valid_header,timeout_ms) values(url,length(headers->>'x-maintenance-secret')>=32,timeout_milliseconds) returning id $$");
        await raw.query(rewrite(readFileSync(new URL('../scripts/maintenance-control.draft.sql', import.meta.url), 'utf8')));
        await t.test('disabled and NULL-start enqueue nothing; pending daily retry deduplicates', async () => {
            assert.equal((await pool.query("select maintenance_control.enqueue('daily-reset') id")).rows[0].id, null);
            await pool.query('delete from maintenance_control.settings');
            assert.equal((await pool.query("select maintenance_control.enqueue('daily-reset') id")).rows[0].id, null);
            await pool.query('insert into maintenance_control.settings(singleton) values(true)');
            const unauthorized = await raw.connect(); try {await unauthorized.query('begin'); await unauthorized.query('set local role anon'); await assert.rejects(unauthorized.query(rewrite("select maintenance_control.enqueue('daily-reset')")), {code: '42501'});} finally {await unauthorized.query('rollback'); unauthorized.release();}
            await pool.query('update maintenance_control.settings set enabled=true');
            assert.equal((await pool.query("select maintenance_control.enqueue('daily-reset') id")).rows[0].id, null);
            await pool.query("update public.daily_reset_state set start_date=(clock_timestamp() at time zone 'Asia/Seoul')::date,last_completed_date=null");
            await raw.query('grant select on ' + base + '_net.http_request_queue to anon');
            await assert.rejects(pool.query("select maintenance_control.enqueue('daily-reset')"), /permissions require review/);
            await raw.query('revoke select on ' + base + '_net.http_request_queue from anon');
            const calls = await Promise.all([pool.query("select maintenance_control.enqueue('daily-reset') id"), pool.query("select maintenance_control.enqueue('daily-reset') id")]);
            assert.equal(calls.filter(x => x.rows[0].id !== null).length, 1);
            assert.equal((await raw.query('select count(*)::int n from ' + base + '_net.sent')).rows[0].n, 1);
        });
        await t.test('HTTP failures, HOLD, malformed response and missing response are never success', async () => {
            const row = (await pool.query('select request_id from maintenance_control.http_run limit 1')).rows[0];
            await raw.query('insert into ' + base + '_net._http_response values($1,503,false,$2)', [row.request_id, JSON.stringify({ok: false, error: {code: 'MAINTENANCE_CONCURRENCY_HOLD'}})]);
            await pool.query('select maintenance_control.refresh_results()'); assert.equal((await pool.query('select outcome from maintenance_control.http_run')).rows[0].outcome, 'HOLD');
            for (const [id, status, content, outcome] of [[100, 200, 'bad-json', 'FAILED'], [101, 200, '{"ok":false}', 'FAILED'], [102, 200, '{"ok":true,"data":{}}', 'OK'], [103, 503, '{"ok":false,"error":{"code":"MAINTENANCE_PARTIAL_FAILURE"}}', 'FAILED']]) {
                await pool.query("insert into maintenance_control.http_run(request_id,job) values($1,'daily-reset')", [id]); await raw.query('insert into ' + base + '_net._http_response values($1,$2,false,$3)', [id, status, content]); await pool.query('select maintenance_control.refresh_results()'); assert.equal((await pool.query('select outcome from maintenance_control.http_run where request_id=$1', [id])).rows[0].outcome, outcome);
            }
            await pool.query("insert into maintenance_control.http_run(request_id,job,queued_at) values(104,'daily-reset',clock_timestamp()-interval '151 seconds')"); await pool.query('select maintenance_control.refresh_results()'); assert.equal((await pool.query('select outcome from maintenance_control.http_run where request_id=104')).rows[0].outcome, 'TIMEOUT');
            assert.ok((await pool.query("select maintenance_control.enqueue('daily-reset') id")).rows[0].id);
            await pool.query("update public.daily_reset_state set last_completed_date=(clock_timestamp() at time zone 'Asia/Seoul')::date");
            assert.equal((await pool.query("select maintenance_control.enqueue('daily-reset') id")).rows[0].id, null);
        });
        await t.test('retention removes only completed maintenance results older than 30 days', async () => {
            await pool.query("insert into maintenance_control.http_run(request_id,job,outcome,checked_at,queued_at) values(90001,'daily-reset','FAILED',clock_timestamp()-interval '31 days',clock_timestamp()-interval '31 days'),(90002,'daily-reset','FAILED',clock_timestamp()-interval '29 days',clock_timestamp()-interval '29 days')");
            const before = (await pool.query('select count(*)::int n from public.action_log')).rows[0].n;
            await pool.query('select maintenance_control.refresh_results()');
            assert.equal((await pool.query('select 1 from maintenance_control.http_run where request_id=90001')).rowCount, 0);
            assert.equal((await pool.query('select 1 from maintenance_control.http_run where request_id=90002')).rowCount, 1);
            assert.equal((await pool.query('select count(*)::int n from public.action_log')).rows[0].n, before);
        });
        const ids = [];
        for (let i = 0; i < 22; i++) {
            const c = (await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,hp,blood,ap,currency) values('expiry','B',12,12,12,70,35,2,5) returning id")).rows[0];
            ids.push((await pool.query("insert into public.battle(character_id,monster_id,area_id,character_hp,monster_hp,monster_max_hp,monster_atk,monster_def,monster_agi,battle_status,started_at) values($1,1,1,70,10,10,1,1,1,'ACTIVE',clock_timestamp()-interval '25 hours') returning id", [c.id])).rows[0].id);
        }
        const repo = createBattleRepository(pool);
        await t.test('ten poison battles roll back; later batches make progress and failed battles retry', async () => {
            failIds = new Set(ids.slice(0, 10).map(String));
            const first = await repo.expireBattles({limit: 10, resilient: true}); assert.equal(first.attempted, 10); assert.equal(first.failed, 10); assert.equal(first.expired, 0);
            assert.equal((await pool.query('select count(*)::int n from public.battle_log')).rows[0].n, 0);
            const second = await repo.expireBattles({limit: 10, resilient: true}); assert.equal(second.expired, 10); assert.equal(second.failed, 0);
            const concurrent = await Promise.all([repo.expireBattles({limit: 10, resilient: true}), repo.expireBattles({limit: 10, resilient: true})]); assert.equal(concurrent.reduce((n, r) => n + r.expired, 0), 2);
            assert.equal((await pool.query("select count(*)::int n from public.battle where battle_status='ACTIVE'")).rows[0].n, 10);
            failIds.clear(); await pool.query("update maintenance_control.battle_expiry_retry set next_attempt_at=clock_timestamp()-interval '1 second'");
            const retry = await repo.expireBattles({limit: 10, resilient: true}); assert.equal(retry.expired, 10);
            assert.equal((await pool.query('select count(*)::int n from public.battle_log')).rows[0].n, 22);
            assert.equal((await pool.query('select count(*)::int n from public.action_log')).rows[0].n, 22);
            assert.equal((await pool.query('select count(*)::int n from maintenance_control.battle_expiry_retry')).rows[0].n, 0);
            assert.equal((await pool.query('select count(*)::int n from public.game_character where hp=70 and blood=35 and ap=2 and currency=5')).rows[0].n, 22);
        });

        await t.test('real PostgreSQL lock timeout rolls back and is retryable', async () => {
            const c = (await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,hp,blood,ap,currency) values('locked','B',12,12,12,70,35,2,5) returning id")).rows[0];
            const b = (await pool.query("insert into public.battle(character_id,monster_id,area_id,character_hp,monster_hp,monster_max_hp,monster_atk,monster_def,monster_agi,battle_status,started_at) values($1,1,1,70,10,10,1,1,1,'ACTIVE',clock_timestamp()-interval '25 hours') returning id", [c.id])).rows[0];
            const blocker = await pool.connect(); await blocker.query('begin'); await blocker.query('select id from public.game_character where id=$1 for update', [c.id]);
            try {                
const failed = await repo.expireBattles({limit: 10, resilient: true}); assert.equal(failed.failed, 1); assert.equal(failed.expired, 0);
                assert.equal((await pool.query('select battle_status from public.battle where id=$1', [b.id])).rows[0].battle_status, 'ACTIVE');
                assert.equal((await pool.query('select last_error_code from maintenance_control.battle_expiry_retry where battle_id=$1', [b.id])).rows[0].last_error_code, '55P03');
            } finally {await blocker.query('rollback'); blocker.release();}
            await pool.query("update maintenance_control.battle_expiry_retry set next_attempt_at=clock_timestamp()-interval '1 second' where battle_id=$1", [b.id]);
            assert.equal((await repo.expireBattles({limit: 10, resilient: true})).expired, 1);
            assert.equal((await pool.query('select count(*)::int n from public.battle_log where battle_id=$1', [b.id])).rows[0].n, 1);
        });
    } finally {await raw.query('rollback'); for (const s of [base + '_control', base + '_net', base + '_vault', base]) await raw.query('drop schema if exists ' + s + ' cascade'); await raw.end();}
});
