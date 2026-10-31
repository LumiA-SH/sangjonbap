import {AppError} from '../../shared/http.js';
export const itemFields = ['name','category','description','transferable','is_active','effect_type','effect_value','usable','use_target','battle_usable'];
export const productFields = ['item_id','price','purchase_limit','stock_limit','daily_limit','is_active','sort_order'];
export function validId(id) {return typeof id==='string' && /^[1-9][0-9]{0,18}$/.test(id) && BigInt(id)<=9223372036854775807n;}
function invalid(message) {throw new AppError(400,'INVALID_ADMIN_INPUT',message);}
export function validateAdminInput(kind,body,create) {
    const fields=kind==='items'?itemFields:productFields;
    if (!body || Array.isArray(body) || typeof body!=='object' || Object.keys(body).some(key=>!fields.includes(key)&&key!=='requestKey')) invalid('허용되지 않은 필드입니다.');
    if (typeof body.requestKey!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey)) invalid('requestKey UUID가 필요합니다.');
    const patch=Object.fromEntries(fields.filter(key=>Object.hasOwn(body,key)).map(key=>[key,body[key]]));
    if (!Object.keys(patch).length) invalid('변경할 필드가 없습니다.');
    const required=kind==='items'?['name','category']:['item_id','price'];
    if (create && required.some(key=>!Object.hasOwn(patch,key))) invalid('필수 필드가 없습니다.');
    if ('name' in patch && (typeof patch.name!=='string' || !patch.name.trim() || [...patch.name].length>100)) invalid('아이템 이름은 1~100자입니다.');
    if ('category' in patch && !['MATERIAL','CONSUMABLE','FOOD','ETC'].includes(patch.category)) invalid('아이템 종류가 올바르지 않습니다.');
    if ('description' in patch && patch.description!==null && typeof patch.description!=='string') invalid('설명은 문자열 또는 NULL입니다.');
    for (const key of ['is_active','transferable','usable','battle_usable']) if (key in patch && typeof patch[key]!=='boolean') invalid(`${key}는 boolean입니다.`);
    if ('item_id' in patch && !validId(patch.item_id)) invalid('아이템 ID는 숫자 문자열이어야 합니다.');
    for (const key of ['price','purchase_limit','stock_limit','daily_limit','sort_order']) {
        if (!(key in patch)) continue;
        if (['purchase_limit','stock_limit','daily_limit'].includes(key) && patch[key]===null) continue;
        const min=['purchase_limit','daily_limit'].includes(key)?1:key==='sort_order'?-2147483648:0;
        if (!Number.isInteger(patch[key]) || patch[key]<min || patch[key]>2147483647) invalid(`${key}의 범위가 올바르지 않습니다.`);
    }
    if('effect_type' in patch && ![null,'BLOOD_PACK'].includes(patch.effect_type))invalid('현재 등록 가능한 효과는 BLOOD_PACK입니다.');
    if('effect_value' in patch && patch.effect_value!==null && (!Number.isInteger(patch.effect_value)||patch.effect_value<1||patch.effect_value>2147483647))invalid('회복량은 양의 정수입니다.');
    if('use_target' in patch && !['NONE','SELF'].includes(patch.use_target))invalid('현재 지원하는 대상은 NONE/SELF입니다.');
    return {patch,requestKey:body.requestKey.toLowerCase()};
}
