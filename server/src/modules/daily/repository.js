import {AppError} from '../../shared/http.js';
import {readNumberSettings, resourceNumber} from '../../shared/settings.js';
import {nextPendingDate} from './date.js';

const stateQuery = `select start_date::text,last_completed_date::text,
    (clock_timestamp() at time zone 'Asia/Seoul')::date::text as today
    from public.daily_reset_state where singleton=true`;

export function createDailyResetRepository(pool) {
    return {
        async getStatus() {
            const {rows} = await pool.query(stateQuery);
            const state = rows[0];
            if (!state) throw new AppError(500, 'DAILY_RESET_STATE_MISSING', '일일 초기화 상태가 없습니다.');
            return {...state, nextDate: nextPendingDate(state.start_date, state.last_completed_date, state.today),
                policyRequired: true};
        },

        // Internal transaction primitive only. No default eligibility or historical
        // config policy, no HTTP route, and no scheduler calls this method.
        async runNextDay(applyConfirmedDay) {
            if (typeof applyConfirmedDay !== 'function') {
                throw new AppError(503, 'DAILY_RESET_POLICY_HOLD', '일일 초기화 대상·소급 정책 확정이 필요합니다.');
            }
            const client = await pool.connect();
            try {
                await client.query('begin');
                const {rows} = await client.query(`${stateQuery} for update`);
                const state = rows[0];
                if (!state) throw new AppError(500, 'DAILY_RESET_STATE_MISSING', '일일 초기화 상태가 없습니다.');
                if (!state.start_date) throw new AppError(503, 'DAILY_RESET_START_HOLD', '최초 초기화 시작일 확정이 필요합니다.');
                const day = nextPendingDate(state.start_date, state.last_completed_date, state.today);
                if (!day) { await client.query('commit'); return null; }
                const currentSettings = await readNumberSettings(client, {daily_blood_decay: resourceNumber});
                // The callback MUST resolve historical eligibility and settings,
                // use this client for all mutations/logs, and never commit itself.
                const detail = await applyConfirmedDay({client, day, currentSettings});
                if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw new Error('Daily audit detail required');
                await client.query('insert into public.daily_reset_run(reset_date,detail) values ($1,$2::jsonb)',
                    [day, JSON.stringify(detail)]);
                await client.query('update public.daily_reset_state set last_completed_date=$1 where singleton=true', [day]);
                await client.query('commit');
                return {date: day, detail};
            } catch (error) {
                await client.query('rollback');
                throw error;
            } finally { client.release(); }
        }
    };
}

export async function catchUpDailyResets(repository, applyConfirmedDay) {
    const completed = [];
    for (;;) {
        const result = await repository.runNextDay(applyConfirmedDay);
        if (!result) return completed;
        completed.push(result);
    }
}
