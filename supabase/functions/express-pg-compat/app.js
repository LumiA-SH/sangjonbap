import express from 'express';
import pg from 'pg';
import {timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {createApp} from '../../../server/src/app.js';

// Separate read-only probe: never import the game server's index.js.
export function createCompatApp({probeToken, databaseUrl, ca}) {
    if (typeof probeToken !== 'string' || probeToken.length < 32) {
        throw new Error('COMPAT_PROBE_TOKEN must contain at least 32 characters.');
    }
    const app = express();
    app.set('env', 'production');
    let pool;
    app.disable('x-powered-by');
    app.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        const supplied = Buffer.from(req.headers['x-compat-token'] || '');
        const expected = Buffer.from(probeToken);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            return res.status(401).json({ok:false,error:{code:'COMPAT_UNAUTHORIZED'}});
        }
        const prefix = '/express-pg-compat';
        if (req.url.startsWith(prefix + '/')) req.url = req.url.slice(prefix.length);
        if (req.method !== 'GET' || !['/api/health', '/api/compat/db'].includes(req.url)) {
            return res.status(404).json({ok:false,error:{code:'COMPAT_ROUTE_DISABLED'}});
        }
        next();
    });
    app.get('/api/compat/db', async (req, res) => {
        if (!databaseUrl) return res.status(503).json({ok:false,error:{code:'COMPAT_DB_UNCONFIGURED'}});
        let client;
        let broken = false;
        try {
            if (!pool) {
                const url = new URL(databaseUrl);
                for (const key of ['sslmode','sslcert','sslkey','sslrootcert']) url.searchParams.delete(key);
                pool = new pg.Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:10000,
                    idleTimeoutMillis:5000,ssl:{rejectUnauthorized:true,...(ca ? {ca} : {})}});
            }
            client = await pool.connect();
            await client.query('begin read only');
            await client.query("set local statement_timeout = '5s'");
            const {rows} = await client.query(`select current_setting('transaction_read_only') as read_only,
                to_regclass('public.game_character') is not null as character_table,
                to_regclass('public.action_log') is not null as action_log_table`);
            await client.query('rollback');
            res.json({ok:true,data:rows[0]});
        } catch (error) {
            if (client) {try {await client.query('rollback');} catch {broken = true;}}
            const code = /^[A-Z0-9_]{1,64}$/.test(error.code || '') ? error.code : 'CONNECTION_FAILED';
            console.error('Compatibility DB check failed', code);
            res.status(503).json({ok:false,error:{code:'COMPAT_DB_FAILED'}});
        } finally {client?.release(broken);}
    });
    // The outer allowlist prevents access to login, gameplay and maintenance.
    // No repository factories or schedulers are started by createApp().
    app.use(createApp({nodeEnv:'production',provider:'mastodon',mode:'supabase',
        origin:'https://survivalbob.site'}, {}));
    return {app, close:async () => {if (pool) await pool.end();}};
}
