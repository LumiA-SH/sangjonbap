import {Router} from 'express';
import {AppError, ok} from '../../shared/http.js';

export function devRoutes(config, repository, sessions) {
    const router = Router();
    router.use((req, res, next) => {
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if (config.nodeEnv !== 'development' || config.provider !== 'dev' || !local) {
            throw new AppError(404, 'NOT_FOUND', '존재하지 않는 API입니다.');
        }
        next();
    });
    router.use(sessions.require);
    router.get('/action-logs', async (req, res) => {
        if (String(req.auth.user.id) !== String(config.userId)) {
            throw new AppError(403, 'DEV_ACCESS_DENIED', '현재 개발 계정만 접근할 수 있습니다.');
        }
        const {requestKey} = req.query;
        if (Object.keys(req.query).some(key => key !== 'requestKey') ||
            (requestKey !== undefined && (typeof requestKey !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)))) {
            throw new AppError(400, 'INVALID_LOG_QUERY', '올바른 requestKey만 조회할 수 있습니다.');
        }
        if (!repository.getDevActionLogs) throw new AppError(501, 'DEV_LOGS_UNAVAILABLE', '로그 조회는 Supabase 모드에서 지원합니다.');
        ok(res, {logs: await repository.getDevActionLogs(req.auth.user.id, requestKey || null)});
    });
    return router;
}
