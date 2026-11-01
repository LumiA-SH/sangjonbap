import {AppError} from '../../shared/http.js';
import {validId} from './service.js';

export const masterFields = {
    areas: ['encounter_rate'],
    foods: ['item_id','blood_recovery','stat_growth_enabled','stat_growth_rate','stat_growth_target','stat_growth_value','rp_effect_text'],
    recipes: ['name','description','discovery_grade','learn_cost','success_rate','result_item_id','failure_item_id','is_active','ingredients'],
    gachas: ['name','price','is_active','start_at','end_at','rewards']
};
export const invalid = message => {throw new AppError(400,'INVALID_ADMIN_INPUT',message);};
export function requestKey(body) {
    if (!body || typeof body.requestKey!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey)) invalid('requestKey UUID가 필요합니다.');
    return body.requestKey.toLowerCase();
}
function integer(value,min,key) {
    if (!Number.isInteger(value) || value<min || value>2147483647) invalid(`${key}: ${min}~2147483647 정수가 필요합니다.`);
}
export function validateMasterInput(kind,body,create) {
    if (kind==='areas' && create) invalid('기존 지역의 조우 확률만 수정할 수 있습니다.');
    const fields=masterFields[kind];
    if (!fields || !body || Array.isArray(body) || typeof body!=='object' || Object.keys(body).some(k=>!fields.includes(k)&&k!=='requestKey')) invalid('허용되지 않은 필드입니다.');
    const key=requestKey(body);
    const patch=Object.fromEntries(fields.filter(k=>Object.hasOwn(body,k)).map(k=>[k,body[k]]));
    if (!Object.keys(patch).length) invalid('변경할 값이 없습니다.');
    const required={areas:[],foods:['item_id'],recipes:['name','success_rate','result_item_id','ingredients'],gachas:['name','price','rewards']}[kind];
    if (create && required.some(k=>!Object.hasOwn(patch,k))) invalid('필수 필드가 없습니다.');
    if (!create && 'item_id' in patch) invalid('음식의 연결 아이템은 변경할 수 없습니다.');
    if ('name' in patch && (typeof patch.name!=='string'||!patch.name.trim()||[...patch.name].length>100)) invalid('이름은 1~100자입니다.');
    if ('discovery_grade' in patch && patch.discovery_grade!==null && !['COMMON','RARE','SPECIAL'].includes(patch.discovery_grade)) invalid('발견 등급은 COMMON/RARE/SPECIAL 또는 미확정 NULL입니다.');
    for (const k of ['description','rp_effect_text']) if (k in patch && patch[k]!==null && typeof patch[k]!=='string') invalid(`${k}: 문자열 또는 NULL이 필요합니다.`);
    for (const k of ['stat_growth_enabled','is_active']) if (k in patch && typeof patch[k]!=='boolean') invalid(`${k}: boolean이 필요합니다.`);
    for (const k of ['item_id','result_item_id','failure_item_id']) if (k in patch && !(k==='failure_item_id'&&patch[k]===null) && !validId(patch[k])) invalid(`${k}: 올바른 ID가 필요합니다.`);
    for (const k of ['blood_recovery','stat_growth_value','learn_cost','price']) if (k in patch) integer(patch[k],0,k);
    for (const k of ['stat_growth_rate','success_rate','encounter_rate']) if (k in patch && (typeof patch[k]!=='number'||!Number.isFinite(patch[k])||patch[k]<0||patch[k]>100||Number(patch[k].toFixed(2))!==patch[k])) invalid(`${k}: 소수 둘째 자리까지의 0~100 확률입니다.`);
    if ('stat_growth_target' in patch && patch.stat_growth_target!==null && !['ATK','DEF','AGI'].includes(patch.stat_growth_target)) invalid('성장 대상은 ATK/DEF/AGI 또는 NULL입니다.');
    for (const k of ['start_at','end_at']) if (k in patch && patch[k]!==null) {
        if (typeof patch[k]!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(patch[k]) || !Number.isFinite(Date.parse(patch[k]))) invalid('시각은 시간대가 포함된 ISO 형식 또는 NULL입니다.');
    }
    for (const k of ['ingredients','rewards']) if (k in patch) {
        if (!Array.isArray(patch[k]) || !patch[k].length) invalid('재료/보상을 한 개 이상 입력하세요.');
        const seen=new Set();
        for (const row of patch[k]) {
            const allowed=k==='ingredients'?['item_id','quantity']:['item_id','quantity','weight'];
            if (!row||Array.isArray(row)||typeof row!=='object'||Object.keys(row).some(f=>!allowed.includes(f))||!validId(row.item_id)) invalid('재료/보상 형식이 올바르지 않습니다.');
            integer(row.quantity,1,'quantity');
            if (k==='rewards') integer(row.weight,1,'weight');
            if (k==='ingredients'&&seen.has(row.item_id)) invalid('같은 재료를 중복 등록할 수 없습니다.');
            seen.add(row.item_id);
        }
    }
    return {patch,requestKey:key};
}
export function validateMasterState(kind,row) {
    if (kind==='foods') {
        if (row.stat_growth_enabled ? !row.stat_growth_target||row.stat_growth_value<=0 : row.stat_growth_target!==null||row.stat_growth_value!==0) invalid('성장 활성 시 대상과 양수 성장량, 비활성 시 대상 NULL과 성장량 0이 필요합니다.');
    }
    if (kind==='recipes' && (row.result_quantity!==3 || !row.failure_item_id)) invalid('성공 수량은 3이며 실패 음식이 필요합니다.');
    // Gacha period ordering is enforced with PostgreSQL timestamptz precision in the repository.
}
