import {AppError} from '../../shared/http.js';

export function createCookingService(repository) {
    function ready() {
        if (!repository.getCookingCatalog || !repository.learnRecipe || !repository.cookRecipe || !repository.eatFood) {
            throw new AppError(501,'COOKING_UNAVAILABLE','요리·식사는 Supabase 모드에서 지원합니다.');
        }
    }
    function validate(id,body) {
        if (typeof id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id)>9223372036854775807n) {
            throw new AppError(400,'INVALID_COOKING_ID','유효한 양의 정수 ID가 필요합니다.');
        }
        if (!body || Array.isArray(body) || Object.keys(body).some(key=>key!=='requestKey') ||
            typeof body.requestKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey)) {
            throw new AppError(400,'INVALID_REQUEST_KEY','requestKey UUID만 입력하세요.');
        }
        ready();
        return body.requestKey.toLowerCase();
    }
    return {
        async getCatalog(userId) {ready();return repository.getCookingCatalog(userId);},
        async learn(userId,id,body) {return repository.learnRecipe(userId,id,validate(id,body));},
        async cook(userId,id,body) {return repository.cookRecipe(userId,id,validate(id,body));},
        async eat(userId,id,body) {return repository.eatFood(userId,id,validate(id,body));}
    };
}
