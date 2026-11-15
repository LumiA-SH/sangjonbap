import {AppError} from '../../shared/http.js';
import {requestKey} from './master-service.js';
import {requireAdminRow,checkDuplicate} from './transaction.js';
import {changeCharacterResources,writeActionLog} from '../../shared/game.js';
import {readNumberSettings,resourceNumber} from '../../shared/settings.js';

// Explicit administrative QA operation. Never called by maintenance or startup.
// Exclusive daily gate prevents concurrent game actions; automatic reset dates stay NULL.
export function createTestDailyReset(pool) {
    return async function testDailyReset(actor,body) {
        const key=requestKey(body);
        if(Object.keys(body).some(k=>k!=='requestKey'))throw new AppError(400,'INVALID_ADMIN_INPUT','허용되지 않은 필드입니다.');
        const c=await pool.connect();
        try {
            await c.query('begin');
            await c.query("set local lock_timeout = '5s'");
            const state=(await c.query('select start_date,last_completed_date from public.daily_reset_state where singleton=true for update')).rows[0];
            if(!state||state.start_date||state.last_completed_date)throw new AppError(409,'TEST_DAILY_RESET_DISABLED','게임 시작 전 테스트 기간에만 수동 초기화할 수 있습니다.');
            await requireAdminRow(c,actor);
            await checkDuplicate(c,key);
            const {day}=(await c.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")).rows[0];
            const settings=await readNumberSettings(c,{daily_blood_decay:resourceNumber});
            const characters=(await c.query('select * from public.game_character order by id for update')).rows;
            let battlesInterrupted=0;
            for(const before of characters) {
                const after=await changeCharacterResources(c,before,{
                    ap:Number(before.max_ap)-Number(before.ap),
                    blood:before.status==='DEAD'?0:-settings.daily_blood_decay
                });
                await c.query('update public.game_character set daily_meal_count=0,daily_training_done=false where id=$1',[before.id]);
                const battles=(await c.query("select id,turn_no from public.battle where character_id=$1 and battle_status='ACTIVE' order by id for update",[before.id])).rows;
                for(const battle of battles) {
                    await c.query("update public.battle set battle_status='DEFEAT',end_reason='ADMIN_TEST_MIDNIGHT',character_hp=$2,ended_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1",[battle.id,after.hp]);
                    await c.query("insert into public.battle_log(battle_id,turn_no,actor_type,action_type,message) values($1,$2,'SYSTEM','TEST_MIDNIGHT','관리자 수동 자정 테스트로 전투 중단')",[battle.id,battle.turn_no]);
                    battlesInterrupted++;
                }
                await writeActionLog(c,{characterId:before.id,adminUserId:actor,category:'CHARACTER',actionType:'TEST_DAILY_RESET_CHARACTER',description:'관리자 수동 자정 테스트',detail:{day,requestKey:key,before,after:{...after,daily_meal_count:0,daily_training_done:false}}});
            }
            // Counter only: purchase history, inventory and action logs are preserved.
            const counters=await c.query('delete from public.blood_pack_purchase_day where purchase_date=$1 returning character_id,quantity',[day]);
            const result={day,charactersReset:characters.length,battlesInterrupted,freePackCountersCleared:counters.rowCount};
            await writeActionLog(c,{adminUserId:actor,category:'ADMIN',actionType:'ADMIN_TEST_DAILY_RESET',description:'테스트용 수동 자정 처리',detail:{...result,clearedCounters:counters.rows},requestKey:key});
            const current=(await c.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
            if(current!==day)throw new AppError(409,'GAME_DAY_CHANGED','날짜가 변경되어 초기화를 취소했습니다.');
            await c.query('commit');return result;
        }catch(error){await c.query('rollback');throw error;}finally{c.release();}
    };
}
