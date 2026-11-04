import {AppError} from '../../shared/http.js';
import {winsReward} from '../investigation/random.js';

export const SUCCESS_QUANTITY = 3;
export const FAILURE_QUANTITY = 1;
export const SUCCESS_RATE = 80;
// Bound per-attempt response/log size; not a daily gameplay limit.
export const MAX_BATCH_QUANTITY = 1000;

export function validateQuantity(quantity) {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_BATCH_QUANTITY) {
        throw new AppError(400,'INVALID_COOKING_QUANTITY',`한 요청의 제작 수량은 1~${MAX_BATCH_QUANTITY} 정수여야 합니다.`);
    }
    return quantity;
}

// Validate full materials before rolling; randomness must never make an unaffordable request valid.
export function planBatch(recipe, ingredients, quantities, quantity, random) {
    validateQuantity(quantity);
    const rate=Number(recipe.success_rate),outputQuantity=Number(recipe.result_quantity);
    if(!Number.isFinite(rate)||rate<0||rate>100||!Number.isSafeInteger(outputQuantity)||outputQuantity<1||outputQuantity>2147483647) {
        throw new AppError(500,'RECIPE_CONFIG_INVALID','레시피 성공률 또는 산출량 설정 오류입니다.');
    }
    for (const row of ingredients) {
        const required = Number(row.quantity) * quantity;
        if (!Number.isSafeInteger(required) || required > (quantities.get(String(row.item_id)) || 0)) {
            throw new AppError(409,'NOT_ENOUGH_INGREDIENTS','전체 제작 수량에 필요한 재료가 부족합니다.');
        }
    }
    const attempts = [];
    const consumed = new Map(), outputs = new Map();
    for (let i = 0; i < quantity; i++) {
        const succeeded = winsReward(rate, random);
        const materials = ingredients.map(row => ({itemId:String(row.item_id), quantity:succeeded ? Number(row.quantity) : Math.max(1,Math.floor(Number(row.quantity)/2))}));
        const output = {itemId:String(succeeded ? recipe.result_item_id : recipe.failure_item_id), quantity:succeeded ? outputQuantity : FAILURE_QUANTITY};
        for (const row of materials) consumed.set(row.itemId,(consumed.get(row.itemId)||0)+row.quantity);
        outputs.set(output.itemId,(outputs.get(output.itemId)||0)+output.quantity);
        attempts.push({attempt:i+1,succeeded,consumed:materials,output});
    }
    const successCount = attempts.filter(row=>row.succeeded).length;
    return {quantity,successCount,failureCount:quantity-successCount,attempts,
        consumed:[...consumed].map(([itemId,quantity])=>({itemId,quantity})),
        outputs:[...outputs].map(([itemId,quantity])=>({itemId,quantity}))};
}
