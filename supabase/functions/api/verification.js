import {requireProxySecret} from './proxy-auth.js';
import express from 'express';
import {Buffer} from 'node:buffer';
import {timingSafeEqual, randomUUID} from 'node:crypto';
import {createEdgeApi} from '../../../server/src/edge-app.js';
import {createOAuthSessions} from '../../../server/src/modules/auth/oauth-session.js';
import {AppError, errorHandler, ok} from '../../../server/src/shared/http.js';

// Verification-only entrypoint. There is deliberately no switch to enable gameplay.
export function createVerificationApi(env, options = {}) {
    const token = env.EDGE_VERIFICATION_TOKEN;
    if (typeof token !== 'string' || token.length < 32) throw new Error('Missing verification access key');
    // OAuth routes are never reachable. No real OAuth credentials are needed or registered.
    const runtime = createEdgeApi({...env, MASTODON_CLIENT_ID:'VERIFICATION_DISABLED',
        MASTODON_CLIENT_SECRET:'VERIFICATION_DISABLED'}, options);
    const verificationOrigin = env.VERIFICATION_FRONTEND_ORIGIN;
    if (verificationOrigin && verificationOrigin !== 'https://lumia-sh.github.io')
        throw new Error('Invalid verification frontend origin');
    const app = express();
    app.set('env', 'production');
    app.disable('x-powered-by');
    app.use(requireProxySecret(env.EDGE_PROXY_SECRET));
    app.use((req, res, next) => {
        res.locals.requestId = randomUUID();
        res.set('Cache-Control', 'no-store');
        res.vary('Origin');
        const origin = req.headers.origin;
        if (origin && origin !== runtime.config.origin && origin !== verificationOrigin) throw new AppError(403, 'ORIGIN_DENIED', '허용되지 않은 출처입니다.');
        if (origin) {
            res.set('Access-Control-Allow-Origin', origin);
            res.set('Access-Control-Allow-Credentials', 'true');
        }
        if (req.method === 'OPTIONS') {
            if (!origin) throw new AppError(403, 'ORIGIN_DENIED', '출처가 필요합니다.');
            res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Edge-Verification-Key');
            return res.sendStatus(204);
        }
        const supplied = Buffer.from(req.get('x-edge-verification-key') || '');
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
            throw new AppError(401, 'VERIFICATION_KEY_REQUIRED', '검증 접근키가 필요합니다.');
        if (req.method !== 'GET') throw new AppError(403, 'VERIFICATION_WRITE_DISABLED', '검증 중 변경 요청은 차단됩니다.');
        next();
    });
    app.get('/api/health', (req, res, next) => runtime.app(req, res, next));
    app.get('/api/compat/db', async (req, res) => {
        const client = await runtime.pool.connect();
        try {
            await client.query('BEGIN READ ONLY');
            const {rows} = await client.query(`select current_setting('transaction_read_only') as read_only,
                to_regclass('public.game_character') is not null as character_table,
                to_regclass('public.action_log') is not null as action_log_table,
                (select start_date is null from public.daily_reset_state where singleton=true) as reset_start_unset`);
            ok(res, {...rows[0], configured_port:Number(new URL(runtime.config.databaseUrl).port), tls_verification:true});
        } finally {
            try { await client.query('ROLLBACK'); } finally { client.release(); }
        }
    });
    // Run the unchanged session validator, but never enter game middleware (even GET can recover daily resets).
    app.get('/api/characters/me', createOAuthSessions(runtime.repository, runtime.config.origin).require,
        () => { throw new AppError(403, 'VERIFICATION_GAME_DISABLED', '검증 중 게임 실행은 차단됩니다.'); });
    app.use(() => { throw new AppError(403, 'VERIFICATION_ROUTE_DISABLED', '검증 허용 경로가 아닙니다.'); });
    app.use(errorHandler);
    return {...runtime, app};
}
