import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as key} from 'node:crypto';
import {createIsolatedPool} from './isolated-pool.js';
import {createDonationRepository} from '../src/modules/character/donation.js';
import {createOperatingPolicyRepository,policyDefaults,validatePolicy} from '../src/modules/admin/operating-policy.js';
import {createGachaRepository} from '../src/modules/gacha/repository.js';

test('policy input fails closed without invented values',()=>{
 for(const [k,v] of Object.entries(policyDefaults))assert.doesNotThrow(()=>validatePolicy(k,v));
 assert.throws(()=>validatePolicy('donation',{...policyDefaults.donation,enabled:true}));
 assert.throws(()=>validatePolicy('donation',{...policyDefaults.donation,cost:101}));
 assert.throws(()=>validatePolicy('recovery',{recipe:'EXECUTE',gacha:'HOLD',battle:'HOLD'}));
 assert.throws(()=>validatePolicy('announcements',{events:{attack:{enabled:true}}}));
});
test('operating policies isolated PostgreSQL',{skip:!process.env.ISOLATED_PG_CONFIG},async t=>{
 const raw=createIsolatedPool(),schema='policies_'+key().replaceAll('-',''),sql=q=>q.replaceAll('public.',schema+'.');
 const scoped=(fault=false)=>({query:(q,p)=>raw.query(sql(q),p),async connect(){const c=await raw.connect();return {release:()=>c.release(),query(q,p){if(fault&&q.includes('insert into public.action_log'))throw Error('audit fault');return c.query(sql(q),p);}};}});
 const pool=scoped(),admin=createOperatingPolicyRepository(pool),donation=createDonationRepository(pool);
 try{
 await t.test('migration preserves legacy data and supports transaction rollback',async()=>{
  const c=await raw.connect(),s=schema+'_migration';
  try{await c.query('begin');await c.query('create schema '+s);
   await c.query(`create table ${s}.system_config(config_key text primary key,config_value jsonb);create table ${s}.gacha(id integer,start_at timestamptz,end_at timestamptz);create table ${s}.action_log(character_id bigint,detail jsonb,action_type text)`);
   await c.query(`insert into ${s}.system_config values('existing','{"value":7}');insert into ${s}.gacha values(1,'2000-01-01T00:00:00Z','2000-01-02T00:00:00Z');insert into ${s}.action_log values(1,'{}','HEAL')`);
   const before=(await c.query(`select row_to_json(g) r from ${s}.gacha g`)).rows;
   await c.query(fs.readFileSync(new URL('../../supabase/migrations/20261109131851_operating_policies.sql',import.meta.url),'utf8').replaceAll('public.',s+'.'));
   assert.deepEqual((await c.query(`select row_to_json(g) r from (select id,start_at,end_at from ${s}.gacha) g`)).rows,before);
   assert.equal((await c.query(`select period_enabled from ${s}.gacha`)).rows[0].period_enabled,null);
   assert.equal((await c.query(`select config_value from ${s}.system_config where config_key='existing'`)).rows[0].config_value.value,7);
   assert.equal((await c.query(`select count(*)::int n from ${s}.action_log`)).rows[0].n,1);
   await c.query('rollback');assert.equal((await c.query('select to_regnamespace($1) n',[s])).rows[0].n,null);
  }finally{await c.query('rollback');c.release();}
 });
 await raw.query('create schema '+schema);
 for(const {tablename} of (await raw.query("select tablename from pg_tables where schemaname='public'")).rows)await raw.query('create table '+schema+'.'+tablename+'(like public.'+tablename+' including all)');
 await pool.query('insert into public.daily_reset_state(singleton) values(true)');
 await raw.query('insert into '+schema+'.system_config select * from public.system_config');
 const account=async(role='USER')=>{const c=(await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,blood,hp,ap,currency) values('donation test','B',10,10,10,80,100,10,10) returning *")).rows[0];const u=(await pool.query("insert into public.auth_user(role,mastodon_instance,mastodon_account_id,character_id) values($1,'test.invalid',$2,$3) returning *",[role,key(),c.id])).rows[0];return {c,u};};
 const owner=await account('ADMIN'),a=await account(),b=await account();
 const settings={enabled:true,cost:10,recovery:15,minimumRemaining:5,maximum:20,dailyLimitEnabled:false,dailyLimit:null};
 const save=async s=>admin.saveOperatingPolicy(owner.u.id,'donation',{settings:s,before:(await admin.getOperatingPolicy('donation')).settings,requestKey:key()});
 const send=async()=>donation.donateBlood(a.u.id,b.c.id,{expected:await donation.previewDonation(a.u.id,b.c.id),requestKey:key()});
 const blood=async id=>(await pool.query('select blood from public.game_character where id=$1',[id])).rows[0].blood;
 await t.test('disabled, required inputs, role, audit and stale admin save',async()=>{
  await assert.rejects(donation.previewDonation(a.u.id,b.c.id),e=>e.code==='DONATION_DISABLED');
  const before=(await admin.getOperatingPolicy('donation')).settings;
  await assert.rejects(admin.saveOperatingPolicy(a.u.id,'donation',{settings,before,requestKey:key()}),e=>e.code==='ADMIN_REQUIRED');
  await save(settings);
  await assert.rejects(admin.saveOperatingPolicy(owner.u.id,'donation',{settings,before,requestKey:key()}),e=>e.code==='POLICY_CHANGED');
  assert.equal((await pool.query("select count(*)::int n from public.action_log where action_type='OPERATING_POLICY_UPDATE'")).rows[0].n,1);
 });
 await t.test('donation amount, cap, duplicate and self rejection',async()=>{
  const expected=await donation.previewDonation(a.u.id,b.c.id),requestKey=key();
  const r=await donation.donateBlood(a.u.id,b.c.id,{expected,requestKey});assert.equal(r.donorBlood,70);assert.equal(r.recipientBlood,95);
  await assert.rejects(donation.donateBlood(a.u.id,b.c.id,{expected,requestKey}),e=>e.code==='DUPLICATE_REQUEST');
  assert.equal((await send()).recovery,5);assert.equal(await blood(b.c.id),100);
  await assert.rejects(send(),e=>e.code==='TARGET_BLOOD_FULL');
  await assert.rejects(donation.previewDonation(a.u.id,a.c.id),e=>e.code==='SELF_DONATION');
 });
 await t.test('concurrent same request, daily limit and rollback',async()=>{
  await pool.query('update public.game_character set blood=20 where id=$1',[b.c.id]);
  const expected=await donation.previewDonation(a.u.id,b.c.id),requestKey=key();
  const results=await Promise.allSettled([donation.donateBlood(a.u.id,b.c.id,{expected,requestKey}),donation.donateBlood(a.u.id,b.c.id,{expected,requestKey})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const original=await blood(a.c.id);
  await assert.rejects(createDonationRepository(scoped(true)).donateBlood(a.u.id,b.c.id,{expected:await donation.previewDonation(a.u.id,b.c.id),requestKey:key()}),/audit fault/);
  assert.equal(await blood(a.c.id),original);
  await save({...settings,dailyLimitEnabled:true,dailyLimit:1});await assert.rejects(send(),e=>e.code==='DONATION_DAILY_LIMIT');await save(settings);
 });
 await t.test('state restrictions and settings changed since confirmation',async()=>{
  for(const state of ['NEAR_DEATH','DEAD']){await pool.query('update public.game_character set status=$1 where id=$2',[state,a.c.id]);await assert.rejects(send(),e=>e.code.startsWith('CHARACTER_'));}
  await pool.query("update public.game_character set status='ALIVE',blood=5 where id=$1",[a.c.id]);await assert.rejects(send(),e=>e.code==='NOT_ENOUGH_BLOOD');
  await pool.query('update public.game_character set blood=80 where id=$1',[a.c.id]);
  await pool.query("update public.game_character set status='DEAD' where id=$1",[b.c.id]);await assert.rejects(send(),e=>e.code==='CHARACTER_DEAD');
  await pool.query("update public.game_character set status='NEAR_DEATH',blood=0 where id=$1",[b.c.id]);
  const expected=await donation.previewDonation(a.u.id,b.c.id);await save({...settings,cost:11});
  await assert.rejects(donation.donateBlood(a.u.id,b.c.id,{expected,requestKey:key()}),e=>e.code==='DONATION_PREVIEW_CHANGED');
  await save(settings);await send();assert.equal((await pool.query('select status from public.game_character where id=$1',[b.c.id])).rows[0].status,'ALIVE');
 });
 await t.test('battle restrictions for either participant',async()=>{
  const area=(await pool.query("insert into public.area(name) values('donation battle') returning id")).rows[0].id;
  const monster=(await pool.query("insert into public.monster(name,max_hp,atk,def,agi) values('test',100,1,1,1) returning id")).rows[0].id;
  for(const id of [a.c.id,b.c.id]){
   const battle=(await pool.query("insert into public.battle(character_id,monster_id,area_id,character_hp,monster_hp,monster_max_hp,monster_atk,monster_def,monster_agi,battle_status) values($1,$2,$3,100,100,100,1,1,1,'ACTIVE') returning id",[id,monster,area])).rows[0].id;
   await assert.rejects(send(),e=>e.code==='BATTLE_ACTIVE');await pool.query('delete from public.battle where id=$1',[battle]);
  }
 });
 await t.test('opposite donations use sorted pair locks without deadlock',async()=>{
  await pool.query('update public.game_character set blood=50 where id=any($1::bigint[])',[[a.c.id,b.c.id]]);
  const pa=await donation.previewDonation(a.u.id,b.c.id),pb=await donation.previewDonation(b.u.id,a.c.id);
  const results=await Promise.all([donation.donateBlood(a.u.id,b.c.id,{expected:pa,requestKey:key()}),donation.donateBlood(b.u.id,a.c.id,{expected:pb,requestKey:key()})]);
  assert.equal(results.length,2);assert.equal(await blood(a.c.id),55);assert.equal(await blood(b.c.id),55);
 });
 await t.test('gacha period disabling preserves stock and uses server time',async()=>{
  const g=(await pool.query("insert into public.gacha(name,start_at,end_at,period_enabled,start_inclusive,end_inclusive) values('period','2000-01-01T00:00:00Z','2000-01-02T00:00:00Z',true,true,true) returning *")).rows[0];
  const repo=createGachaRepository(pool);assert.equal((await repo.getGachaCatalog(a.u.id)).gachas.find(r=>r.id===g.id).outside,true);
  await pool.query('update public.gacha set period_enabled=false where id=$1',[g.id]);assert.equal((await repo.getGachaCatalog(a.u.id)).gachas.find(r=>r.id===g.id).outside,false);
  await assert.rejects(pool.query('update public.gacha set period_enabled=true,start_inclusive=null where id=$1',[g.id]),e=>e.code==='23514');
  const item=(await pool.query("insert into public.item(name,category,transferable,usable,battle_usable,use_target) values('RP','ETC',true,false,false,'NONE') returning id")).rows[0].id;
  await pool.query('insert into public.gacha_reward(gacha_id,item_id,quantity,weight,max_stock,remaining_stock) values($1,$2,1,1,20,20)',[g.id,item]);
  // Inject only the database period clock, preserving real transactions, locks and rewards.
  const at=time=>createGachaRepository({async connect(){const c=await pool.connect();return {release:()=>c.release(),query:(q,p)=>c.query(q.includes('cross join (select clock_timestamp()')?q.replace('clock_timestamp()',`'${time}'::timestamptz`):q,p)};}});
  for(const edge of ['start','end'])for(const inclusive of [false,true]){
   await pool.query(`update public.gacha set period_enabled=true,${edge==='start'?'end':'start'}_inclusive=true,${edge}_inclusive=$2 where id=$1`,[g.id,inclusive]);
   const promise=at(edge==='start'?'2000-01-01T00:00:00Z':'2000-01-02T00:00:00Z').drawGacha(a.u.id,g.id,key());
   if(inclusive)assert.equal((await promise).price,1);else await assert.rejects(promise,e=>e.code==='GACHA_CLOSED');
  }
  await pool.query('update public.gacha set period_enabled=false where id=$1',[g.id]);assert.equal((await at('2099-01-01').drawGacha(a.u.id,g.id,key())).reward.quantity,1);
 });
 }finally{await raw.query('drop schema if exists '+schema+' cascade');await raw.end();}
});
