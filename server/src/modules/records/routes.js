import {Router} from 'express';
import {AppError, ok} from '../../shared/http.js';
import {validId} from '../admin/service.js';

export function recordsCursor(query) {
    if (Object.keys(query).some(k => k !== 'before') || (query.before !== undefined && !validId(query.before))) {
        throw new AppError(400, 'INVALID_RECORD_CURSOR', '올바른 이전 기록 ID를 입력하세요.');
    }
    return query.before || null;
}
export function recordsPage(rows) {
    return {records: rows.slice(0, 30), nextBefore: rows.length > 30 ? rows[29].id : null};
}
export function recordsRoutes(repository, sessions) {
    const router = Router();
    router.use(sessions.require);
    for (const [path, method] of [['action-logs', 'getActionRecords'], ['investigations', 'getActionRecords'],
        ['discoveries', 'getDiscoveryRecords'], ['clues', 'getClueRecords']]) {
        router.get(`/${path}`, async (req, res) => {
            const before = recordsCursor(req.query);
            if (!req.auth.user.character_id) throw new AppError(403, 'CHARACTER_REQUIRED', '승인된 캐릭터 연결이 필요합니다.');
            if (!repository[method]) throw new AppError(501, 'RECORDS_UNAVAILABLE', '기록 조회는 Supabase 모드에서 지원합니다.');
            ok(res, recordsPage(await repository[method](req.auth.user.id, before, path === 'investigations')));
        });
    }
    return router;
}
