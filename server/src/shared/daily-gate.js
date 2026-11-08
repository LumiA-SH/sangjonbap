import {AppError} from './http.js';
import {nextPendingDate} from '../modules/daily/date.js';

const days = new WeakMap();

export function gameTransactionDay(client) { return days.get(client) || null; }

export async function rollbackGameTransaction(client) {
    try { await client.query('rollback'); }
    finally { days.delete(client); }
}

// This is the first lock in a game transaction. Recovery takes the same singleton
// FOR UPDATE, before any character/battle locks. Readers never upgrade this lock.
export async function beginGameTransaction(client) {
    days.delete(client);
    await client.query('begin');
    await client.query("set local lock_timeout = '5s'");
    const state = (await client.query(`select start_date::text,last_completed_date::text
        from public.daily_reset_state where singleton=true for share`)).rows[0];
    if (!state) throw new AppError(503,'DAILY_RESET_STATE_MISSING','일일 초기화 상태를 확인할 수 없습니다.');
    const {day} = (await client.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")).rows[0];
    if (state.start_date && nextPendingDate(state.start_date,state.last_completed_date,day)) {
        throw new AppError(503,'DAILY_RESET_REQUIRED','일일 초기화가 필요합니다. 잠시 후 같은 요청으로 다시 시도하세요.');
    }
    days.set(client, day);
}

export async function commitGameTransaction(client) {
    const admittedDay = days.get(client);
    if (!admittedDay) throw new Error('Game transaction has no daily gate');
    const {day} = (await client.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")).rows[0];
    if (day !== admittedDay) {
        throw new AppError(409,'GAME_DAY_CHANGED','처리 중 날짜가 변경되어 취소되었습니다. 같은 요청으로 다시 시도하세요.');
    }
    // The final day check is the ordering point, not physical WAL commit time.
    // Recovery cannot pass this transaction's shared lock until commit/rollback.
    await client.query('commit');
    days.delete(client);
}
