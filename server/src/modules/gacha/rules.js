import {AppError} from '../../shared/http.js';
import {chooseResult, randomUnit} from '../investigation/random.js';

export function validateRewards(rewards) {
    const ids=rewards.filter(row=>row.item_id!=null).map(row=>String(row.item_id));
    if(new Set(ids).size!==ids.length)throw new AppError(500,'GACHA_REWARDS_INVALID','중복 보상 아이템 설정입니다.');
    if(rewards.some(row=>row.max_stock==null||row.remaining_stock==null))throw new AppError(409,'GACHA_STOCK_HOLD','기존 보상의 재고 전환 설정이 필요합니다.');
    const total = rewards.reduce((sum,row) => sum + row.remaining_stock,0);
    if (!rewards.every(row => Number.isInteger(row.max_stock)&&row.max_stock>=1&&row.max_stock<=2147483647&&
        Number.isInteger(row.remaining_stock)&&row.remaining_stock>=0&&row.remaining_stock<=row.max_stock) || !Number.isSafeInteger(total)) {
        throw new AppError(500,'GACHA_REWARDS_INVALID','보상 재고 설정이 올바르지 않습니다.');
    }
    if(!total)throw new AppError(409,'GACHA_SOLD_OUT','모든 가챠 보상이 품절되었습니다.');
    return total;
}
export function selectReward(rewards, random = randomUnit) {
    validateRewards(rewards);
    const candidates=rewards.filter(row=>row.remaining_stock>0);
    const selected=chooseResult(candidates.map(row=>({...row,weight:row.remaining_stock})),random);
    return candidates.find(row=>row.id===selected.id);
}
export function requireRpItem(item) {
    if(!item?.is_active||item.transferable!==true||item.usable!==false||item.battle_usable!==false||item.effect_type!=null||item.effect_value!=null||item.use_target!=='NONE'||item.category==='FOOD')
        throw new AppError(409,'GACHA_RP_ITEM_REQUIRED','가챠는 양도 가능하며 사용·전투·음식 효과가 없는 RP 아이템만 등록할 수 있습니다.');
}
export function validateStockChange(before,after) {
    if(!Number.isInteger(after.max_stock)||after.max_stock<1||after.max_stock>2147483647||!Number.isInteger(after.remaining_stock)||after.remaining_stock<0||after.remaining_stock>after.max_stock)
        throw new AppError(400,'INVALID_GACHA_STOCK','최대 재고는 1 이상, 잔여 재고는 0~최대 재고 정수입니다.');
    const issued=before?.max_stock==null?0:before.max_stock-before.remaining_stock;
    if(after.max_stock-after.remaining_stock!==issued)throw new AppError(409,'GACHA_STOCK_CONFLICT','이미 당첨된 수량은 변경할 수 없습니다. 최대·잔여 재고를 같은 수량만큼 조정하세요.');
}
export function requirePeriod(period) {
    if (period.boundary) throw new AppError(409,'GACHA_PERIOD_POLICY_HOLD','운영 기간 경계 포함 정책 확정 대기 중입니다.');
    if (period.outside) throw new AppError(409,'GACHA_CLOSED','가챠 운영 기간이 아닙니다.');
}
