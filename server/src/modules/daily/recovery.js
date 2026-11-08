import {AppError} from '../../shared/http.js';
import {changeCharacterResources, characterState, writeActionLog} from '../../shared/game.js';
import {readNumberSettings, resourceNumber} from '../../shared/settings.js';
import {nextPendingDate} from './date.js';

// Without a complete lifecycle ledger, death/revival counters can prove only
// the never-dead case. Do not infer historical state from updated_at.
export function recoveryDecayReason(character, boundary, previous, lifecycleAtBoundary = null) {
    if (new Date(character.created_at).getTime() >= new Date(boundary).getTime()) {
        return 'CREATED_AFTER_BOUNDARY';
    }

    if (character.status !== 'ALIVE' || Number(character.hp) <= 0) {
        return 'NOT_ALIVE';
    }

    // A dated revival ledger can establish the boundary state even when counters
    // changed since yesterday. Merely having one pending date proves nothing.
    if (lifecycleAtBoundary?.status === 'ALIVE' &&
        Number(lifecycleAtBoundary.death_count) === Number(character.death_count) &&
        Number(lifecycleAtBoundary.revive_count) === Number(character.revive_count)) {
        return null;
    }

    const unchangedSinceReset = previous?.status === 'ALIVE' &&
        Number(previous.death_count) === Number(character.death_count) &&
        Number(previous.revive_count) === Number(character.revive_count);

    if (!unchangedSinceReset &&
        (Number(character.death_count) !== 0 || Number(character.revive_count) !== 0)) {
        return 'LIFECYCLE_HISTORY_INCOMPLETE';
    }

    return null;
}

export function createDailyRecovery(pool) {
    return async function recoverDailyReset() {
        const client=await pool.connect();
        try {
            await client.query('begin');
            await client.query("set local lock_timeout = '5s'");
            const state=(await client.query(`select start_date::text,last_completed_date::text
                from public.daily_reset_state where singleton=true for update`)).rows[0];
            if(!state) throw new AppError(500,'DAILY_RESET_STATE_MISSING','일일 초기화 상태가 없습니다.');
            // Clock is read AFTER acquiring the cross-instance lock.
            const {today,boundary}=(await client.query(`with instant as materialized (select clock_timestamp() ts)
                select (ts at time zone 'Asia/Seoul')::date::text today,
                ((ts at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul') boundary from instant`)).rows[0];
            if(!state.start_date){await client.query('commit');return {hold:'DAILY_RESET_START_HOLD'};}
            const first=nextPendingDate(state.start_date,state.last_completed_date,today);
            if(!first){await client.query('commit');return {completed:[]};}
            const settings=await readNumberSettings(client,{daily_blood_decay:resourceNumber});
            const characters=(await client.query('select * from public.game_character order by id for update')).rows;
            const previous=new Map((await client.query(`select distinct on (character_id)
                character_id,detail->'after' as state from public.action_log
                where action_type='DAILY_RESET' and detail->>'to'=$1
                order by character_id,id desc`,[state.last_completed_date])).rows.map(r=>[String(r.character_id),r.state]));
            // Only a single boundary can use a pre-boundary revival as evidence.
            // Multi-day recovery retains the conservative counter-history policy.
            const lifecycle = new Map(first === today ? (await client.query(`select distinct on (target_id)
                target_id,detail->'after'->'target' as state from public.action_log
                where action_type='REVIVE' and target_type='CHARACTER' and created_at < $1
                  and detail->>'dailyTransactionDay'=(created_at at time zone 'Asia/Seoul')::date::text
                order by target_id,created_at desc,id desc`,[boundary])).rows.map(r=>[String(r.target_id),r.state]) : []);
            // Older servers/direct clients may already have processed today's
            // actions. Never erase their meals/AP/flags by a late reset.
            const activity=await client.query(`select 1 from public.action_log l
                join public.game_character c on c.id=l.character_id
                where l.created_at >= $1 and c.created_at < $1
                  and l.action_type not in ('DAILY_RESET','DEATH') limit 1`,[boundary]);
            if(activity.rowCount) throw new AppError(503,'DAILY_RESET_ACTIVITY_HOLD',
                '오늘 행동 기록이 이미 있어 지연 초기화를 자동 적용할 수 없습니다. 운영자 확인이 필요합니다.');
            const detail={from:first,to:today,mode:'COALESCED_RECOVERY',bloodDecay:settings.daily_blood_decay,
                resetCount:0,decayCount:0,skippedDecay:{}};
            for(const before of characters) {
                // A new character must not receive resets for dates before birth.
                if(new Date(before.created_at).getTime()>=new Date(boundary).getTime()) continue;
                const reason = recoveryDecayReason(before,boundary,previous.get(String(before.id)),lifecycle.get(String(before.id)));
                const after=await changeCharacterResources(client,before,{
                    ap:Number(before.max_ap)-Number(before.ap),
                    blood:before.status==='NEAR_DEATH'?-Number(before.blood):reason?0:-settings.daily_blood_decay
                });
                await client.query(`update public.game_character set daily_meal_count=0,
                    daily_training_done=false where id=$1`,[before.id]);
                // Character locks precede battle locks, as in commands and timeout processing.
                // No turn resolution or reward code runs on a midnight defeat.
                if (after.status === 'NEAR_DEATH' && Number(after.blood) === 0) {
                    const battles = await client.query(`select id,turn_no from public.battle
                        where character_id=$1 and battle_status='ACTIVE' order by id for update`, [before.id]);
                    for (const battle of battles.rows) {
                        await client.query(`update public.battle set battle_status='DEFEAT',
                            end_reason='MIDNIGHT_NEAR_DEATH',character_hp=$2,ended_at=clock_timestamp(),
                            updated_at=clock_timestamp() where id=$1`, [battle.id, after.hp]);
                        await client.query(`insert into public.battle_log(battle_id,turn_no,actor_type,action_type,message)
                            values($1,$2,'SYSTEM','MIDNIGHT_DEFEAT','빈사로 인한 전투 중단')`, [battle.id, battle.turn_no]);
                        await writeActionLog(client, {characterId:before.id,category:'BATTLE',actionType:'BATTLE_MIDNIGHT_DEFEAT',
                            targetType:'BATTLE',targetId:battle.id,description:'빈사로 인한 전투 중단',
                            detail:{date:today,turnNo:battle.turn_no,bloodBefore:before.blood,bloodAfter:after.blood}});
                    }
                }
                await writeActionLog(client,{characterId:before.id,category:'CHARACTER',actionType:'DAILY_RESET',
                    description:'KST 일일 초기화 및 누락 기간 통합 복구',
                    detail:{from:first,to:today,decaySkipped:reason,before:characterState(before),after:characterState(after),
                        apBefore:before.ap,apAfter:after.ap}});
                detail.resetCount++;
                if(reason)detail.skippedDecay[reason]=(detail.skippedDecay[reason]||0)+1;
                else detail.decayCount++;
            }
            const result=await client.query(`insert into public.daily_reset_run(reset_date,detail)
                select day::date,$3::jsonb from generate_series($1::date,$2::date,interval '1 day') day
                order by day returning reset_date::text`,[first,today,JSON.stringify(detail)]);
            await client.query('update public.daily_reset_state set last_completed_date=$1 where singleton=true',[today]);
            await client.query('commit');
            return {completed:result.rows.map(r=>r.reset_date),detail};
        } catch(error){await client.query('rollback');throw error;}
        finally{client.release();}
    };
}
