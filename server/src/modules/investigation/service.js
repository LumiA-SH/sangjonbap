import {AppError} from '../../shared/http.js';

export function createInvestigationService(repository) {
  function requireRepository() {
    if (!repository.getInvestigationAreas || !repository.investigate) {
      throw new AppError(501, 'INVESTIGATION_UNAVAILABLE', '조사는 Supabase 모드에서 지원합니다.');
    }
  }

  return {
    async getAreas(userId) {
      requireRepository();
      return repository.getInvestigationAreas(userId);
    },

    async investigate(userId, areaId, body) {
      if (typeof areaId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(areaId) || BigInt(areaId) > 9223372036854775807n) {
        throw new AppError(400, 'INVALID_AREA_ID', '지역 ID는 유효한 양의 정수여야 합니다.');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(key => key !== 'requestKey')) {
        throw new AppError(400, 'INVALID_INVESTIGATION_REQUEST', 'requestKey만 입력하세요.');
      }
      if (typeof body.requestKey !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey)) {
        throw new AppError(400, 'INVALID_REQUEST_KEY', 'requestKey가 올바른 UUID 형식이 아닙니다.');
      }
      requireRepository();
      return repository.investigate(userId, areaId, body.requestKey);
    }
  };
}
