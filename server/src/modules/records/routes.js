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
            const {requestKey,...query}=req.query;
            if(requestKey!==undefined&&(path!=='action-logs'||typeof requestKey!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)))throw new AppError(400,'INVALID_RECORD_CURSOR','올바른 요청키가 필요합니다.');
            const before = recordsCursor(query);
            if (!req.auth.user.character_id) throw new AppError(403, 'CHARACTER_REQUIRED', '승인된 캐릭터 연결이 필요합니다.');
            if (!repository[method]) throw new AppError(501, 'RECORDS_UNAVAILABLE', '기록 조회는 Supabase 모드에서 지원합니다.');
            const args=[req.auth.user.id,before,path==='investigations'];
            if(requestKey!==undefined)args.push(requestKey.toLowerCase());
            ok(res, recordsPage(await repository[method](...args)));
        });
    }
    return router;
}
