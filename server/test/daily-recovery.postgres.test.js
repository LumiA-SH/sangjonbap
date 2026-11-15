import {readFileSync} from 'node:fs';
import {createShopRepository} from '../src/modules/shop/repository.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool as createPool} from './isolated-pool.js';
import {createDailyRecovery} from '../src/modules/daily/recovery.js';

test('coalesced daily recovery isolated PostgreSQL', {skip: process.env.RUN_DAILY_DB_TESTS !== '1'}, async t => {
    const raw = createPool(), schema = 'test_reset_' + randomUUID().replaceAll('-', '');
    const rewrite = q => q.replaceAll('public.', schema + '.');
    let fail = false;
    const pool = {        
query: (q, p) => raw.query(rewrite(q), p), async connect() {            
const c = await raw.connect(); return {
                release: () => c.release(), query(q, p) {if (fail && q.startsWith('insert into public.daily_reset_run')) throw new Error('injected'); return c.query(rewrite(q), p);}
            };        
}    
};
    try {
        await raw.query(`create schema ${schema}`);
        for (const table of ['daily_reset_state', 'daily_reset_run', 'system_config', 'game_character', 'action_log', 'battle', 'battle_log'])
            await raw.query(`create table ${schema}.${table} (like public.${table} including all)`);
        await pool.query('insert into public.daily_reset_state(singleton) values(true)');
        await pool.query("insert into public.system_config(config_key,config_value) values('daily_blood_decay','10')");
        const today = (await raw.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
        const prior = n => new Date(Date.parse(today + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
        const reset = async () => {
            await pool.query('truncate public.action_log,public.game_character,public.daily_reset_run');
            await pool.query('update public.daily_reset_state set start_date=$1,last_completed_date=null', [prior(2)]);
            await pool.query("update public.system_config set config_value='10'");
        };
        const character = async (status = 'ALIVE', extra = {}) => (await pool.query(`insert into public.game_character
            (name,hunter_grade,atk,def,agi,status,hp,blood,ap,max_ap,daily_meal_count,daily_training_done,created_at,death_count,revive_count)
            values ('isolated reset','B',12,12,12,$1,$2,$3,1,10,3,true,$4,$5,$6) returning *`,
            [status, extra.hp ?? (status === 'DEAD' ? 0 : 50), extra.blood ?? (status === 'ALIVE' ? 35 : 0), extra.created ?? prior(5) + 'T00:00:00+09:00', extra.deaths ?? 0, extra.revives ?? 0])).rows[0];
        const get = async id => (await pool.query('select * from public.game_character where id=$1', [id])).rows[0];
        const run = createDailyRecovery(pool);
        await t.test('unset start does not mutate', async () => {
            assert.equal((await run()).hold, 'DAILY_RESET_START_HOLD');
            assert.equal((await pool.query('select * from public.daily_reset_run')).rowCount, 0);
        });
        await t.test('multiple missed dates, once-only decay and all-status counters', async () => {
            await reset(); const alive = await character(), near = await character('NEAR_DEATH'), dead = await character('DEAD');
            const result = await run(); assert.deepEqual(result.completed, [prior(2), prior(1), today]);
            assert.equal((await get(alive.id)).blood, 25);
            for (const c of [alive, near, dead]) {const after = await get(c.id); assert.equal(after.ap, 10); assert.equal(after.daily_meal_count, 0); assert.equal(after.daily_training_done, false);}
            assert.equal((await get(near.id)).status, 'NEAR_DEATH'); assert.equal((await get(dead.id)).status, 'DEAD');
            assert.deepEqual((await run()).completed, []); assert.equal((await get(alive.id)).blood, 25);
        });
        await t.test('concurrent instances deduct once', async () => {
            await reset(); const c = await character();
            const results = await Promise.all([run(), run(), run()]);
            assert.equal(results.filter(r => r.completed.length).length, 1); assert.equal((await get(c.id)).blood, 25);
        });
        await t.test('one pending day uses each max_ap and charges only one day', async () => {
            await reset(); await pool.query('update public.daily_reset_state set start_date=$1', [today]);
            const c = await character(); await pool.query('update public.game_character set max_ap=17 where id=$1', [c.id]);
            assert.deepEqual((await run()).completed, [today]); assert.equal((await get(c.id)).ap, 17);
            assert.equal((await get(c.id)).blood, 25);
        });
        await t.test('rollback logs/counters/history and retry', async () => {
            await reset(); const c = await character(); fail = true; await assert.rejects(run(), /injected/); fail = false;
            assert.equal((await get(c.id)).ap, 1); assert.equal((await get(c.id)).blood, 35);
            assert.equal((await pool.query('select * from public.action_log')).rowCount, 0);
            assert.equal((await pool.query('select * from public.daily_reset_run')).rowCount, 0);
            await run(); assert.equal((await get(c.id)).blood, 25);
        });
        await t.test('creation boundary, uncertain lifecycle, HP zero and blood zero', async () => {
            await reset(); const fresh = await character('ALIVE', {created: today + 'T00:00:00+09:00'});
            const revived = await character('ALIVE', {deaths: 1, revives: 1}), low = await character('ALIVE', {blood: 5}), zero = await character('ALIVE', {hp: 0});
            await run(); assert.equal((await get(fresh.id)).ap, 1); assert.equal((await get(revived.id)).blood, 35);
            assert.equal((await get(low.id)).status, 'NEAR_DEATH'); assert.equal((await get(low.id)).blood, 0);
            assert.equal((await get(zero.id)).status, 'DEAD'); assert.equal((await get(zero.id)).death_count, 1);
        });
        await t.test('today activity holds without erasing already-earned state', async () => {
            await reset(); const c = await character(); await pool.query(`insert into public.action_log(character_id,category,action_type,description) values($1,'CHARACTER','DAILY_TRAINING','test')`, [c.id]);
            await assert.rejects(run(), {code: 'DAILY_RESET_ACTIVITY_HOLD'}); assert.equal((await get(c.id)).ap, 1);
        });
        await t.test('invalid and missing settings rollback', async () => {
            await reset(); await character(); await pool.query(`update public.system_config set config_value='"10"'`);
            await assert.rejects(run(), {code: 'SYSTEM_CONFIG_INVALID'}); await pool.query('delete from public.system_config');
            await assert.rejects(run(), {code: 'SYSTEM_CONFIG_MISSING'});
        });
    } finally {await raw.query(`drop schema if exists ${schema} cascade`); await raw.end();}
});

import {createTestDailyReset} from '../src/modules/admin/test-daily-reset.js';
import {createInvestigationRepository} from '../src/modules/investigation/repository.js';
import {createAdminRepository} from '../src/modules/admin/repository.js';
import {enqueueOpenAreas} from '../src/modules/mastodon-system/jobs.js';

test('QA manual reset, scheduled visibility and action descriptions preserve HOLD', {skip:process.env.RUN_DAILY_DB_TESTS!=='1'}, async t=>{
 const raw=createPool(), schema='qa_'+randomUUID().replaceAll('-','');
 const rewrite=q=>q.replaceAll('public.',schema+'.');let failAudit=false;
 const pool={query:(q,p)=>raw.query(rewrite(q),p),async connect(){const c=await raw.connect();return {release:()=>c.release(),query(q,p){if(failAudit&&q.includes('insert into public.action_log'))throw Error('injected audit failure');return c.query(rewrite(q),p);}};}};
 try{
  await raw.query('create schema '+schema);
  const tables=(await raw.query("select tablename from pg_tables where schemaname='public'")).rows;
  for(const {tablename} of tables)await raw.query(`create table ${schema}."${tablename}" (like public."${tablename}" including all)`);
  if(!(await raw.query("select 1 from information_schema.columns where table_schema=$1 and table_name='mastodon_event' and column_name='visibility'",[schema])).rowCount) await pool.query(readFileSync(new URL('../../supabase/migrations/20261115110543_mastodon_delivery.sql',import.meta.url),'utf8'));
  // Local baseline predates this production column; match the verified production type.
  await pool.query('alter table public.item add column if not exists blood_pack_kind varchar(20)');
  const view=(await raw.query("select pg_get_viewdef('public.investigation_progress'::regclass,true) definition")).rows[0].definition;
  const viewClient=await raw.connect();try{await viewClient.query('begin');await viewClient.query('set local search_path to '+schema+',public');await viewClient.query('create view '+schema+'.investigation_progress as '+rewrite(view));await viewClient.query('commit');}finally{viewClient.release();}

  await pool.query('insert into public.daily_reset_state(singleton) values(true)');
  await pool.query("insert into public.system_config(config_key,config_value) values('daily_blood_decay','10'),('investigation_ap_cost','1')");
  const alive=(await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,hp,blood,ap,daily_meal_count,daily_training_done) values('QA','B',12,12,12,70,35,1,3,true) returning *")).rows[0];
  const admin=(await pool.query("insert into public.auth_user(role,character_id) values('ADMIN',$1) returning id",[alive.id])).rows[0];
  const user=(await pool.query("insert into public.auth_user(role) values('USER') returning id")).rows[0];
  const reset=createTestDailyReset(pool);
  await t.test('unauthorized actor and configured start reject without mutations',async()=>{
   await assert.rejects(reset(user.id,{requestKey:randomUUID()}),{code:'ADMIN_REQUIRED'});
   await pool.query('update public.daily_reset_state set start_date=current_date');
   await assert.rejects(reset(admin.id,{requestKey:randomUUID()}),{code:'TEST_DAILY_RESET_DISABLED'});
   await pool.query('update public.daily_reset_state set start_date=null');
   assert.equal((await pool.query('select ap from public.game_character where id=$1',[alive.id])).rows[0].ap,1);
  });
  await t.test('audit failure rolls back resources, flags and counters',async()=>{
   failAudit=true;await assert.rejects(reset(admin.id,{requestKey:randomUUID()}),/injected/);failAudit=false;
   const c=(await pool.query('select * from public.game_character where id=$1',[alive.id])).rows[0];assert.equal(c.blood,35);assert.equal(c.daily_meal_count,3);
  });
  await t.test('concurrent identical reset applies once, leaves HP and HOLD dates unchanged',async()=>{
   const day=(await pool.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
   await pool.query('insert into public.blood_pack_purchase_day(character_id,purchase_date,quantity) values($1,$2,1)',[alive.id,day]);
   const dead=(await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,status,hp,blood,ap) values('dead','B',12,12,12,'DEAD',0,50,0) returning id")).rows[0];
   await pool.query("insert into public.battle(character_id,monster_id,area_id,character_hp,monster_hp,monster_max_hp,monster_atk,monster_def,monster_agi,battle_status) values($1,1,1,70,10,10,1,1,1,'ACTIVE')",[alive.id]);
   const key=randomUUID(),results=await Promise.allSettled([reset(admin.id,{requestKey:key}),reset(admin.id,{requestKey:key})]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(results.find(r=>r.status==='fulfilled').value.battlesInterrupted,1);
   assert.equal((await pool.query('select end_reason from public.battle')).rows[0].end_reason,'ADMIN_TEST_MIDNIGHT');assert.equal(results.find(r=>r.status==='rejected').reason.code,'DUPLICATE_REQUEST');
   const c=(await pool.query('select * from public.game_character where id=$1',[alive.id])).rows[0];assert.equal(c.blood,25);assert.equal(c.hp,70);assert.equal(c.ap,10);assert.equal(c.daily_meal_count,0);assert.equal(c.daily_training_done,false);
   const d=(await pool.query('select * from public.game_character where id=$1',[dead.id])).rows[0];assert.equal(d.blood,50);assert.equal(d.ap,10);
   assert.equal((await pool.query('select * from public.blood_pack_purchase_day')).rowCount,0);
   const state=(await pool.query('select * from public.daily_reset_state')).rows[0];assert.equal(state.start_date,null);assert.equal(state.last_completed_date,null);
   assert.equal((await pool.query("select * from public.action_log where action_type='ADMIN_TEST_DAILY_RESET'")).rowCount,1);
  });
  await t.test('free-pack reset preserves purchase history and permits exactly one more purchase',async()=>{
   const item=(await pool.query("insert into public.item(name,category,effect_type,effect_value,blood_pack_kind,usable,battle_usable,transferable,use_target) values('QA pack','CONSUMABLE','BLOOD_PACK',10,'FREE',true,true,true,'SELF') returning id")).rows[0];
   const product=(await pool.query('insert into public.shop_product(item_id,price,daily_limit) values($1,0,1) returning id',[item.id])).rows[0];
   const shop=createShopRepository(pool);
   await shop.buyProduct(admin.id,product.id,1,randomUUID());
   await assert.rejects(shop.buyProduct(admin.id,product.id,1,randomUUID()),{code:'DAILY_LIMIT_EXCEEDED'});
   await reset(admin.id,{requestKey:randomUUID()});
   await shop.buyProduct(admin.id,product.id,1,randomUUID());
   await assert.rejects(shop.buyProduct(admin.id,product.id,1,randomUUID()),{code:'DAILY_LIMIT_EXCEEDED'});
   assert.equal((await pool.query('select * from public.shop_purchase where product_id=$1',[product.id])).rowCount,2);
   assert.equal((await pool.query('select quantity from public.inventory where item_id=$1',[item.id])).rows[0].quantity,2);
  });
  await t.test('schedule before/after boundary, manual re-lock and invalid schedule',async()=>{
   const area=(await pool.query("insert into public.area(name,is_open,auto_unlock,unlock_at) values('scheduled',false,true,clock_timestamp()+interval '1 hour') returning id")).rows[0];

   await pool.query("insert into public.system_config(config_key,config_value) values('operating_announcements',$1)",[JSON.stringify({events:{area_unlock:{enabled:true,visibility:'unlisted'}}})]);
   assert.equal(await enqueueOpenAreas(pool),0);
   const repo=createInvestigationRepository(pool);
   assert.equal((await repo.getInvestigationAreas(admin.id)).areas.length,0);
   await assert.rejects(repo.investigate(admin.id,area.id,randomUUID()),{code:'AREA_CLOSED'});
   await pool.query("update public.area set unlock_at=clock_timestamp()-interval '1 second' where id=$1",[area.id]);
   assert.equal((await repo.getInvestigationAreas(admin.id)).areas[0].is_open,true);
   await Promise.all([enqueueOpenAreas(pool),enqueueOpenAreas(pool)]);
   assert.equal((await pool.query("select * from public.mastodon_event where event_type='area_unlock'")).rowCount,1);
   await assert.rejects(repo.investigate(admin.id,area.id,randomUUID()),{code:'NO_INVESTIGATION_RESULT'});
   await pool.query('update public.area set auto_unlock=false where id=$1',[area.id]);
   assert.equal((await repo.getInvestigationAreas(admin.id)).areas.length,0);
   await assert.rejects(pool.query('update public.area set auto_unlock=true,unlock_at=null where id=$1',[area.id]),{code:'23514'});
  });
  await t.test('action description survives administrator save and database constraint',async()=>{
   const repo=createAdminRepository(pool);
   const body={name:'QA monster',description:null,image_url:null,max_hp:10,atk:1,def:1,agi:1,is_active:false,areas:[],drops:[],actions:[{name:'attack',description:'행동 설명',action_type:'ATTACK',probability:100,multiplier:1,is_active:true,sort_order:0}],requestKey:randomUUID()};
   const result=await repo.saveAdminMonster(admin.id,null,body);
   assert.equal(result.actions[0].description,'행동 설명');
   await assert.rejects(repo.saveAdminMonster(user.id,null,{...body,requestKey:randomUUID()}),{code:'ADMIN_REQUIRED'});
   await assert.rejects(pool.query('update public.monster_action set description=$1',['x'.repeat(2001)]),{code:'23514'});
  });
 }finally{await raw.query('drop schema if exists '+schema+' cascade');await raw.end();}
});
