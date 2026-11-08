import {Buffer} from 'node:buffer';
import {timingSafeEqual} from 'node:crypto';
import {AppError} from '../../../server/src/shared/http.js';

export function requireProxySecret(secret) {
    if (typeof secret !== 'string' || secret.length < 32) throw new Error('Missing EDGE_PROXY_SECRET');
    const expected = Buffer.from(secret);
    return (req, res, next) => {
        const supplied = Buffer.from(req.get('x-sangjonbap-proxy') || '');
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
            throw new AppError(403, 'PROXY_REQUIRED', '허용된 API 경로를 이용하세요.');
        next();
    };
}
