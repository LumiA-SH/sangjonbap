import {AppError} from '../../shared/http.js';
import {bloodLimit} from '../../shared/balance.js';

function validateRequest(targetId, body) {
    if (typeof targetId !== 'string' || !/^[1-9][0-9]*$/.test(targetId) ||
        targetId.length > 19 || BigInt(targetId) > 9223372036854775807n) {
        throw new AppError(400, 'INVALID_CHARACTER_ID', '올바른 캐릭터 ID가 필요합니다.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => key !== 'requestKey') ||
        typeof body.requestKey !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey)) {
        throw new AppError(400, 'INVALID_REQUEST_KEY', 'requestKey UUID만 입력하세요.');
    }
}

// Called by the repository only after both rows have been locked.
export function planCare(action, provider, target, settings) {
    if (!provider) throw new AppError(404, 'CHARACTER_NOT_FOUND', '연결된 활성 캐릭터가 없습니다.');
    if (!target) throw new AppError(404, 'TARGET_NOT_FOUND', '활성 대상 캐릭터가 없습니다.');
    const revive = action === 'REVIVE';
    if (revive && String(provider.id) === String(target.id)) {
        throw new AppError(409, 'SELF_REVIVE', '자신의 부활 제공자가 될 수 없습니다.');
    }
    if (provider.status === 'DEAD' || Number(provider.hp) <= 0) {
        throw new AppError(409, 'CHARACTER_DEAD', '사망한 캐릭터는 치료나 부활을 제공할 수 없습니다.');
    }
    if (revive && target.status !== 'DEAD') {
        throw new AppError(409, 'TARGET_NOT_DEAD', '사망한 캐릭터만 부활할 수 있습니다.');
    }
    if (!revive && (target.status === 'DEAD' || Number(target.hp) <= 0)) {
        throw new AppError(409, 'TARGET_DEAD', '사망한 대상에게는 부활이 필요합니다.');
    }
    if(provider.status==='NEAR_DEATH')throw new AppError(409,'CHARACTER_NEAR_DEATH','빈사 상태에서는 치료·부활을 제공할 수 없습니다.');
    const cost = revive ? settings.revive_blood_cost : settings.heal_blood_cost;
    if (Number(provider.blood) < cost) {
        throw new AppError(409, 'NOT_ENOUGH_BLOOD', '제공자의 혈량이 부족합니다.');
    }
    if (revive && (Number(target.max_hp) < settings.revive_hp || bloodLimit(target) < settings.revive_blood)) {
        throw new AppError(409, 'REVIVE_LIMIT_CONFLICT', '대상의 최대 HP 또는 혈량이 부활 규칙과 충돌합니다.');
    }
    return {
        cost, revive,
        targetChanges: revive
            ? {hp: settings.revive_hp - Number(target.hp), blood: settings.revive_blood - Number(target.blood)}
            : {hp: settings.heal_hp_recovery}
    };
}

export function createCharacterCareService(repository) {
    async function perform(action, userId, targetId, body) {
        validateRequest(targetId, body);
        if (typeof repository.performCharacterCare !== 'function') {
            throw new AppError(501, 'CARE_UNAVAILABLE', '치료 및 부활은 Supabase 모드에서 지원합니다.');
        }
        return repository.performCharacterCare(userId, targetId, body.requestKey, action,
            (provider, target, settings) => planCare(action, provider, target, settings));
    }
    return {
        heal: (userId, targetId, body) => perform('HEAL', userId, targetId, body),
        revive: (userId, targetId, body) => perform('REVIVE', userId, targetId, body)
    };
}
