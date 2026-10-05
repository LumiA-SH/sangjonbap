import {AppError} from '../../shared/http.js';

const RESOURCE_KEYS = ['hp', 'blood', 'ap', 'currency'];
const ALLOWED_KEYS = [...RESOURCE_KEYS, 'reason'];

function getInteger(value, key) {
    if (value === undefined) return 0;

    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new AppError(400, 'INVALID_RESOURCE_CHANGE', `${key}는 정수 증감값이어야 합니다.`);
    }

    return value;
}

export function createCharacterService(repository) {
    return {
        async changeResources(userId, body) {
            if (!body || typeof body !== 'object' || Array.isArray(body)) {
                throw new AppError(400, 'INVALID_RESOURCE_CHANGE', '잘못된 자원 변경 요청입니다.');
            }

            const invalidKeys = Object.keys(body).filter(key => !ALLOWED_KEYS.includes(key));

            if (invalidKeys.length) {
                throw new AppError(
                    400,
                    'INVALID_RESOURCE_CHANGE',
                    `허용되지 않은 필드입니다: ${invalidKeys.join(', ')}`
                );
            }

            if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 100) {
                throw new AppError(400, 'INVALID_RESOURCE_REASON', 'reason은 1~100자로 입력하세요.');
            }

            const changes = {
                hp: getInteger(body.hp, 'hp'),
                blood: getInteger(body.blood, 'blood'),
                ap: getInteger(body.ap, 'ap'),
                currency: getInteger(body.currency, 'currency')
            };

            if (RESOURCE_KEYS.every(key => changes[key] === 0)) {
                throw new AppError(400, 'EMPTY_RESOURCE_CHANGE', '변경할 자원이 없습니다.');
            }

            const character = await repository.changeResources(userId, changes, body.reason.trim());

            if (!character) {
                throw new AppError(404, 'CHARACTER_NOT_FOUND', '연결된 활성 캐릭터가 없습니다.');
            }

            return character;
        }
    };
}