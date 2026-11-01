import {AppError} from './http.js';

export const MAX_BLOOD = 100;

// Never silently convert legacy character data while processing an unrelated action.
export function bloodLimit(character) {
    if (Number(character.blood) > MAX_BLOOD) {
        throw new AppError(409, 'LEGACY_BLOOD_HOLD', '혈량 100 초과 데이터는 운영자 전환 확인이 필요합니다.');
    }
    return Math.min(MAX_BLOOD, Number(character.max_blood));
}
