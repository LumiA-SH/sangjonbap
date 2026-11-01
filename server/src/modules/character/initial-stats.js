import {AppError} from '../../shared/http.js';

// Future character creation must call this; no existing character is rescaled.
export function validateInitialStats(grade,stats) {
    const total={B:36,A:40,S:45}[grade];
    const values=['atk','def','agi'].map(key=>stats?.[key]);
    if (!total||values.some(v=>!Number.isInteger(v)||v<8||v>40)||values.reduce((a,b)=>a+b,0)!==total) {
        throw new AppError(400,'INVALID_INITIAL_STATS','초기 스탯은 각각 8~40 정수이며 B/A/S 합계는 36/40/45입니다.');
    }
    return {atk:stats.atk,def:stats.def,agi:stats.agi};
}
