import {AppError} from '../../shared/http.js';
import {chooseResult, randomUnit} from '../investigation/random.js';

export function validateRewards(rewards) {
    const total = rewards.reduce((sum,row) => sum + Number(row.weight),0);
    if (!rewards.length || !rewards.every(row => Number.isSafeInteger(Number(row.weight)) && Number(row.weight)>0 &&
        Number.isSafeInteger(Number(row.quantity)) && Number(row.quantity)>0) || !Number.isSafeInteger(total)) {
        throw new AppError(500,'GACHA_REWARDS_INVALID','보상 수량 또는 가중치 설정이 올바르지 않습니다.');
    }
    return total;
}
export function selectReward(rewards, random = randomUnit) {
    validateRewards(rewards);
    return chooseResult(rewards,random);
}
export function requirePeriod(period) {
    if (period.boundary) throw new AppError(409,'GACHA_PERIOD_POLICY_HOLD','운영 기간 경계 포함 정책 확정 대기 중입니다.');
    if (period.outside) throw new AppError(409,'GACHA_CLOSED','가챠 운영 기간이 아닙니다.');
}
