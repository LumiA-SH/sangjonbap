import {AppError} from '../../shared/http.js';

function validatePositiveId(value, name) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new AppError(400, 'INVALID_INVENTORY_REQUEST', `${name}은 1 이상의 정수여야 합니다.`);
    }
}

function validateRequestKey(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new AppError(400, 'INVALID_REQUEST_KEY', 'requestKey가 올바른 UUID 형식이 아닙니다.');
    }
}

function validateBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new AppError(400, 'INVALID_INVENTORY_REQUEST', '잘못된 요청입니다.');
    }

    const keys = Object.keys(body);
    const allowed = ['itemId','quantity','requestKey'];

    if (keys.some(key => !allowed.includes(key))) {
        throw new AppError(400, 'INVALID_INVENTORY_REQUEST', 'itemId, quantity, requestKey만 입력하세요.');
    }

    validatePositiveId(body.itemId, 'itemId');
    validatePositiveId(body.quantity, 'quantity');
    validateRequestKey(body.requestKey);

    return {
        itemId:body.itemId,
        quantity:body.quantity,
        requestKey:body.requestKey
    };
}

function resultOrThrow(result) {
    switch (result.type) {
        case 'OK':
            return result;

        case 'CHARACTER_NOT_FOUND':
            throw new AppError(404, 'CHARACTER_NOT_FOUND', '연결된 활성 캐릭터가 없습니다.');

        case 'ITEM_NOT_FOUND':
            throw new AppError(404, 'ITEM_NOT_FOUND', '존재하지 않거나 비활성화된 아이템입니다.');

        case 'NOT_TRANSFERABLE':
            throw new AppError(400, 'ITEM_NOT_TRANSFERABLE', '이 아이템은 이동할 수 없습니다.');

        case 'NOT_ENOUGH_INVENTORY':
            throw new AppError(409, 'NOT_ENOUGH_INVENTORY', '보유한 아이템 수량이 부족합니다.');

        case 'NOT_ENOUGH_STORAGE':
            throw new AppError(409, 'NOT_ENOUGH_STORAGE', '공용창고의 아이템 수량이 부족합니다.');

        case 'DUPLICATE_REQUEST':
            throw new AppError(409, 'DUPLICATE_REQUEST', '이미 처리된 요청입니다.');

        default:
            throw new AppError(500, 'INVENTORY_ERROR', '아이템 처리 중 오류가 발생했습니다.');
    }
}

export function createInventoryService(repository) {
    return {
        async getInventory(userId) {
            return repository.getInventory(userId);
        },

        async getStorage() {
            return repository.getStorage();
        },

        async deposit(userId, body) {
            const input = validateBody(body);
            const result = await repository.deposit(userId, input.itemId, input.quantity, input.requestKey);
            return resultOrThrow(result);
        },

        async withdraw(userId, body) {
            const input = validateBody(body);
            const result = await repository.withdraw(userId, input.itemId, input.quantity, input.requestKey);
            return resultOrThrow(result);
        }
    };
}