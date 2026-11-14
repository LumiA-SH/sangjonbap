import {AppError} from '../../shared/http.js';
import {sampleUnit} from './engine.js';

export function ingredientCandidates(drops) {
    return drops.filter(row=>row.item_id!=null && ['BASE','BONUS'].includes(row.ingredient_role));
}

export function requireIngredientDrops(drops) {
    const bases=drops.filter(row=>row.ingredient_role==='BASE');
    const bonuses=drops.filter(row=>row.ingredient_role==='BONUS');

    if (bases.length!==1) {
        throw new AppError(409,'MONSTER_INGREDIENT_REQUIRED','마물에는 기본 식재료가 정확히 1종 필요합니다.');
    }

    if (drops.some(row=>
        row.is_ingredient!==['BASE','BONUS'].includes(row.ingredient_role) ||
        (row.ingredient_role!=null && !['BASE','BONUS'].includes(row.ingredient_role))
    )) {
        throw new AppError(409,'MONSTER_INGREDIENT_INVALID','마물 식재료 구분을 확인하세요.');
    }

    const validQuantity=row=>row.item_id!=null && row.recipe_id==null && row.min_quantity===1 && row.max_quantity===1;
    if (!validQuantity(bases[0]) || Number(bases[0].drop_rate)!==100) {
        throw new AppError(409,'MONSTER_BASE_INGREDIENT_INVALID','기본 식재료는 100% 확률로 1개 지급해야 합니다.');
    }

    if (bonuses.some(row=>!validQuantity(row)||!Number.isFinite(Number(row.drop_rate))||
        Number(row.drop_rate)<0||Number(row.drop_rate)>100)) {
        throw new AppError(409,'MONSTER_BONUS_INGREDIENT_INVALID','추가 식재료의 수량과 확률을 확인하세요.');
    }

    const total=bonuses.reduce((sum,row)=>sum+Number(row.drop_rate),0);
    if (total>100.000001) {
        throw new AppError(409,'MONSTER_BONUS_RATE_INVALID','추가 식재료 확률의 합계는 100% 이하여야 합니다.');
    }

    return {base:bases[0],bonuses};
}

export function victoryCurrency(random) {
    return sampleUnit(random)<0.5?1:2;
}

export function guaranteedIngredient(drops) {
    const {base}=requireIngredientDrops(drops);
    return {drop:base,quantity:1};
}

export function additionalIngredient(drops,random) {
    const {bonuses}=requireIngredientDrops(drops);
    if (!bonuses.length) return null;

    let cursor=sampleUnit(random)*100;

    for (const drop of bonuses) {
        cursor-=Number(drop.drop_rate);
        if (cursor<0) return {drop,quantity:1};
    }

    return null;
}