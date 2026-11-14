import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool} from './isolated-pool.js';
import {createSystemOutbox, enqueueSystemEvent} from '../src/modules/mastodon-system/outbox.js';
test('existing outbox isolated migration, atomic rollback, dedupe and concurrent claims', {skip: !process.env.ISOLATED_PG_CONFIG}, async () => {
    const raw = createIsolatedPool(), schema = 'system_post_' + randomUUID().replaceAll('-', ''), rewrite = q => q.replaceAll('public.', schema + '.');
    const pool = {query: (q, p) => raw.query(rewrite(q), p), async connect() {const c = await raw.connect(); return {release: () => c.release(), query: (q, p) => c.query(rewrite(q), p)};} };
    await raw.query(`create schema ${schema}`);
    try {
        await raw.query(`create table ${schema}.mastodon_event(like public.mastodon_event including all);create table ${schema}.system_config(like public.system_config including all)`);
        await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261110160000_mastodon_delivery.sql', import.meta.url), 'utf8'));
        await pool.query("insert into public.system_config(config_key,config_value) values('operating_announcements',$1)", [JSON.stringify({events: {death: {enabled: true, visibility: 'unlisted', template: '{character} 사망', retryEnabled: true, maxAttempts: 3, retryMinutes: 5}}})]);
        const event = {type: 'death', key: '1:1', values: {character: '테스트'}};
        const c = await pool.connect(); await c.query('begin'); await enqueueSystemEvent(c, event); await c.query('rollback'); c.release();
        assert.equal((await pool.query('select * from public.mastodon_event')).rowCount, 0);
        await enqueueSystemEvent(pool, event); await enqueueSystemEvent(pool, event);
        assert.equal((await pool.query('select * from public.mastodon_event')).rowCount, 1);
        const outbox = createSystemOutbox(pool), claims = await Promise.all([outbox.claim(), outbox.claim()]); assert.equal(claims.filter(Boolean).length, 1);
        await outbox.finish(claims.find(Boolean), {remoteId: '789'}); assert.equal((await pool.query('select status from public.mastodon_event')).rows[0].status, 'SENT');
        await enqueueSystemEvent(pool, {...event, key: '1:2'});
        await pool.query("update public.mastodon_event set attempt_at=clock_timestamp()-interval '10 seconds'");
        const claimed = await outbox.claim(); await outbox.finish(claimed, {error: 'RATE_LIMITED', retry: true, delay: 300}); assert.equal(await outbox.claim(), null);
        await pool.query("update public.mastodon_event set next_attempt_at=clock_timestamp()-interval '1 second',attempt_at=clock_timestamp()-interval '10 seconds' where status='FAILED'");
        const retried = await outbox.claim(); assert.ok(retried);
        await pool.query("update public.mastodon_event set lease_until=clock_timestamp()-interval '1 second',attempt_at=clock_timestamp()-interval '10 seconds' where lease_token is not null");
        assert.equal(await outbox.claim(), null); assert.equal((await pool.query("select last_error from public.mastodon_event where status='FAILED'")).rows[0].last_error, 'DELIVERY_UNCERTAIN');
    } finally {await raw.query(`drop schema ${schema} cascade`); await raw.end();}
});
