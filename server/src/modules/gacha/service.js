import {AppError} from '../../shared/http.js';
export function createGachaService(repository) {
    function ready() {
        if (!repository.getGachaCatalog || !repository.drawGacha) throw new AppError(501,'GACHA_UNAVAILABLE','가챠는 Supabase 모드에서 지원합니다.');
    }
    return {
        async getCatalog(userId) {ready();return repository.getGachaCatalog(userId);},
        async draw(userId,id,body) {
            if (typeof id!=='string' || !/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id)>9223372036854775807n) throw new AppError(400,'INVALID_GACHA_ID','가챠 ID는 양의 정수여야 합니다.');
            if (!body || Array.isArray(body) || Object.keys(body).some(key=>key!=='requestKey') || typeof body.requestKey!=='string' ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey)) {
                throw new AppError(400,'INVALID_REQUEST_KEY','requestKey UUID만 입력하세요.');
            }
            ready();return repository.drawGacha(userId,id,body.requestKey.toLowerCase());
        }
    };
}
