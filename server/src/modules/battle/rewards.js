import {AppError} from '../../shared/http.js';
import {sampleUnit} from './engine.js';

export function ingredientCandidates(drops) {
    return drops.filter(row => row.item_id != null && row.is_ingredient && Number(row.drop_rate) > 0);
}
export function requireIngredientDrops(drops) {
    if (!ingredientCandidates(drops).length) throw new AppError(409, 'MONSTER_INGREDIENT_REQUIRED', '양수 확률의 식재료 드롭이 최소 1종 필요합니다.');
}
export function victoryCurrency(random) { return sampleUnit(random) < 0.5 ? 1 : 2; }
export function guaranteedIngredient(drops, random) {
    requireIngredientDrops(drops);
    const candidates = ingredientCandidates(drops);
    let cursor = sampleUnit(random) * candidates.reduce((sum,row) => sum + Number(row.drop_rate),0);
    const selected = candidates.find(row => (cursor -= Number(row.drop_rate)) < 0) || candidates.at(-1);
    return {drop: selected, quantity: selected.min_quantity + Math.floor(sampleUnit(random) * (selected.max_quantity-selected.min_quantity+1))};
}
