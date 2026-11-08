import assert from 'node:assert/strict';
import {createCompatApp} from './app.js';

async function exercise(databaseUrl?: string, ca?: string) {
    const probeToken = crypto.randomUUID();
    const {app, close} = createCompatApp({probeToken, databaseUrl, ca});
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = {'x-compat-token':probeToken};
    try {
        const unauthorized = await fetch(base + '/api/health');
        assert.equal(unauthorized.status, 401);
        await unauthorized.text();
        for (const path of ['/api/health','/express-pg-compat/api/health']) {
            const result = await fetch(base + path, {headers});
            assert.equal(result.status, 200);
            const body = await result.json();
            assert.equal(body.ok, true);
            assert.equal(body.data.status, 'up');
            assert.equal(body.data.mode, 'supabase');
            assert.ok(body.requestId);
        }
        for (const path of ['/api/auth/mastodon/login','/api/characters/me','/api/battles/active']) {
            const result = await fetch(base + path, {headers});
            assert.equal(result.status, 404);
            await result.text();
        }
        const write = await fetch(base + '/api/health', {method:'POST',headers});
        assert.equal(write.status, 404);
        await write.text();
        const result = await fetch(base + '/express-pg-compat/api/compat/db', {headers});
        const body = await result.json();
        assert.equal(result.status, databaseUrl ? 200 : 503);
        if (databaseUrl) {
            assert.equal(body.ok, true);
            assert.equal(body.data.read_only, 'on');
            assert.equal(body.data.character_table, true);
            assert.equal(body.data.action_log_table, true);
        } else assert.equal(body.error.code, 'COMPAT_DB_UNCONFIGURED');
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await close();
    }
}

Deno.test('Express 5.2.1: existing app routing, allowlist and missing DB configuration', async () => {
    await exercise();
});

Deno.test({
    name:'pg 8.16.3: real PostgreSQL read-only transaction over verified TLS',
    ignore:Deno.env.get('COMPAT_READ_DB') !== '1',
    fn:async () => {
        const url = Deno.env.get('COMPAT_DATABASE_URL') || Deno.env.get('DATABASE_URL');
        assert.ok(url, 'Database URL must be provided by environment');
        const caPath = Deno.env.get('DATABASE_CA_PATH');
        const ca = Deno.env.get('COMPAT_DATABASE_CA') || (caPath ? await Deno.readTextFile(caPath) : undefined);
        await exercise(url, ca);
    }
});
