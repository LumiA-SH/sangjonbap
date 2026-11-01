import {AppError} from './http.js';

// Call only after locking the character. Battle writers use character -> battle too.
export async function requireNoActiveBattle(client, character) {
    const result = await client.query("select id from public.battle where character_id=$1 and battle_status='ACTIVE' for share", [character.id]);
    if (result.rowCount) throw new AppError(409, 'BATTLE_ACTIVE', '전투 중에는 전투 행동과 조회만 가능합니다.');
}

export function requireActionCharacter(character,{allowNearDeath=false}={}) {
    if (!character) throw new AppError(404,'CHARACTER_NOT_FOUND','활성 캐릭터가 없습니다.');
    if (character.status==='DEAD'||Number(character.hp)<=0) throw new AppError(409,'CHARACTER_DEAD','사망 상태에서는 행동할 수 없습니다.');
    if (!allowNearDeath&&(character.status==='NEAR_DEATH'||Number(character.blood)<=0)) throw new AppError(409,'CHARACTER_NEAR_DEATH','빈사 상태에서는 이 행동을 할 수 없습니다.');
}
export async function currentKstDay(client) {
    return (await client.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
}
export async function rejectActionDuplicate(client,key) {
    if ((await client.query('select id from public.action_log where request_key=$1',[key])).rowCount) throw new AppError(409,'DUPLICATE_REQUEST','이미 처리된 요청입니다.');
}
export async function actionTransaction(pool,work) {
    const c=await pool.connect();
    try {await c.query('begin');const result=await work(c);await c.query('commit');return result;}
    catch(e){await c.query('rollback');if(e.code==='23505'&&e.constraint==='action_log_request_key_key')throw new AppError(409,'DUPLICATE_REQUEST','이미 처리된 요청입니다.');throw e;}
    finally{c.release();}
}
