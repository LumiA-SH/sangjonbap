import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool as createPool} from './isolated-pool.js';
import {createDailyRecovery} from '../src/modules/daily/recovery.js';

test('coalesced daily recovery isolated PostgreSQL', {skip:process.env.RUN_DAILY_DB_TESTS!=='1'},async t=>{
    const raw=createPool(),schema='test_reset_'+randomUUID().replaceAll('-','');
    const rewrite=q=>q.replaceAll('public.',schema+'.');
    let fail=false;
    const pool={query:(q,p)=>raw.query(rewrite(q),p),async connect(){const c=await raw.connect();return {
        release:()=>c.release(),query(q,p){if(fail&&q.startsWith('insert into public.daily_reset_run'))throw new Error('injected');return c.query(rewrite(q),p);}
    };}};
    try {
        await raw.query(`create schema ${schema}`);
        for(const table of ['daily_reset_state','daily_reset_run','system_config','game_character','action_log','battle','battle_log'])
            await raw.query(`create table ${schema}.${table} (like public.${table} including all)`);
        await pool.query('insert into public.daily_reset_state(singleton) values(true)');
        await pool.query("insert into public.system_config(config_key,config_value) values('daily_blood_decay','10')");
        const today=(await raw.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
        const prior=n=>new Date(Date.parse(today+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
        const reset=async()=>{
            await pool.query('truncate public.action_log,public.game_character,public.daily_reset_run');
            await pool.query('update public.daily_reset_state set start_date=$1,last_completed_date=null',[prior(2)]);
            await pool.query("update public.system_config set config_value='10'");
        };
        const character=async(status='ALIVE',extra={})=>(await pool.query(`insert into public.game_character
            (name,hunter_grade,atk,def,agi,status,hp,blood,ap,max_ap,daily_meal_count,daily_training_done,created_at,death_count,revive_count)
            values ('isolated reset','B',12,12,12,$1,$2,$3,1,10,3,true,$4,$5,$6) returning *`,
            [status,extra.hp??(status==='DEAD'?0:50),extra.blood??(status==='ALIVE'?35:0),extra.created??prior(5)+'T00:00:00+09:00',extra.deaths??0,extra.revives??0])).rows[0];
        const get=async id=>(await pool.query('select * from public.game_character where id=$1',[id])).rows[0];
        const run=createDailyRecovery(pool);
        await t.test('unset start does not mutate',async()=>{
            assert.equal((await run()).hold,'DAILY_RESET_START_HOLD');
            assert.equal((await pool.query('select * from public.daily_reset_run')).rowCount,0);
        });
        await t.test('multiple missed dates, once-only decay and all-status counters',async()=>{
            await reset();const alive=await character(),near=await character('NEAR_DEATH'),dead=await character('DEAD');
            const result=await run();assert.deepEqual(result.completed,[prior(2),prior(1),today]);
            assert.equal((await get(alive.id)).blood,25);
            for(const c of [alive,near,dead]){const after=await get(c.id);assert.equal(after.ap,10);assert.equal(after.daily_meal_count,0);assert.equal(after.daily_training_done,false);}
            assert.equal((await get(near.id)).status,'NEAR_DEATH');assert.equal((await get(dead.id)).status,'DEAD');
            assert.deepEqual((await run()).completed,[]);assert.equal((await get(alive.id)).blood,25);
        });
        await t.test('concurrent instances deduct once',async()=>{
            await reset();const c=await character();
            const results=await Promise.all([run(),run(),run()]);
            assert.equal(results.filter(r=>r.completed.length).length,1);assert.equal((await get(c.id)).blood,25);
        });
        await t.test('one pending day uses each max_ap and charges only one day',async()=>{
            await reset();await pool.query('update public.daily_reset_state set start_date=$1',[today]);
            const c=await character();await pool.query('update public.game_character set max_ap=17 where id=$1',[c.id]);
            assert.deepEqual((await run()).completed,[today]);assert.equal((await get(c.id)).ap,17);
            assert.equal((await get(c.id)).blood,25);
        });
        await t.test('rollback logs/counters/history and retry',async()=>{
            await reset();const c=await character();fail=true;await assert.rejects(run(),/injected/);fail=false;
            assert.equal((await get(c.id)).ap,1);assert.equal((await get(c.id)).blood,35);
            assert.equal((await pool.query('select * from public.action_log')).rowCount,0);
            assert.equal((await pool.query('select * from public.daily_reset_run')).rowCount,0);
            await run();assert.equal((await get(c.id)).blood,25);
        });
        await t.test('creation boundary, uncertain lifecycle, HP zero and blood zero',async()=>{
            await reset();const fresh=await character('ALIVE',{created:today+'T00:00:00+09:00'});
            const revived=await character('ALIVE',{deaths:1,revives:1}),low=await character('ALIVE',{blood:5}),zero=await character('ALIVE',{hp:0});
            await run();assert.equal((await get(fresh.id)).ap,1);assert.equal((await get(revived.id)).blood,35);
            assert.equal((await get(low.id)).status,'NEAR_DEATH');assert.equal((await get(low.id)).blood,0);
            assert.equal((await get(zero.id)).status,'DEAD');assert.equal((await get(zero.id)).death_count,1);
        });
        await t.test('today activity holds without erasing already-earned state',async()=>{
            await reset();const c=await character();await pool.query(`insert into public.action_log(character_id,category,action_type,description) values($1,'CHARACTER','DAILY_TRAINING','test')`,[c.id]);
            await assert.rejects(run(),{code:'DAILY_RESET_ACTIVITY_HOLD'});assert.equal((await get(c.id)).ap,1);
        });
        await t.test('invalid and missing settings rollback',async()=>{
            await reset();await character();await pool.query(`update public.system_config set config_value='"10"'`);
            await assert.rejects(run(),{code:'SYSTEM_CONFIG_INVALID'});await pool.query('delete from public.system_config');
            await assert.rejects(run(),{code:'SYSTEM_CONFIG_MISSING'});
        });
    } finally {await raw.query(`drop schema if exists ${schema} cascade`);await raw.end();}
});

