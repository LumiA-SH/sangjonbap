export const itemCategoryLabels = Object.freeze({MATERIAL:'재료',CONSUMABLE:'소모품',FOOD:'음식',ETC:'기타'});
export const itemCategoryLabel = value => itemCategoryLabels[value] || (value ? '미분류' : '기타');
