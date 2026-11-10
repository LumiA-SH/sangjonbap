import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID as key} from 'node:crypto';
import {createIsolatedPool} from './isolated-pool.js';
import {createPublicContentRepository,validateContent,contentTime,scheduleState} from '../src/modules/public-content/repository.js';
import {createInteractionRepository} from '../src/modules/character/interactions.js';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';
test('content date validation and KST exact boundaries',()=>{
 const start='2026-12-24T00:00:00+09:00',end='2027-01-11T00:00:00+09:00',s=contentTime(start);assert.equal(new Date(s).toISOString(),'2026-12-23T15:00:00.000Z');
 assert.equal(scheduleState(start,end,s-1),'UPCOMING');assert.equal(scheduleState(start,end,s),'ONGOING');assert.equal(scheduleState(start,end,contentTime(end)-1),'ONGOING');assert.equal(scheduleState(start,end,contentTime(end)),'ENDED');
 for(const invalid of ['2026-02-30T12:00:00+09:00','2026-12-24','2026-12-24T24:00:00+09:00','2026-12-24T00:00:00','bad'])assert.throws(()=>contentTime(invalid));
 assert.throws(()=>validateContent('schedule',{title:'a',body:'',published:true,startAt:end,endAt:start,items:[]}));assert.throws(()=>validateContent('world',{title:'a',body:'x',published:true,admin:true}));
});
test('guest public routes are read-only, independent of auth and recovery',async t=>{
 const repo=createMemoryRepository();let reset=0,writes=0;repo.recoverDailyReset=async()=>reset++;repo.getPublicContent=async()=>({content:null});repo.listVisitorCharacters=async()=>[];repo.getVisitorCharacter=async()=>({id:'1',name:'a',status:'DEAD'});repo.saveAdminContent=async()=>writes++;
 const server=createApp({provider:'dev',nodeEnv:'development',origin:'http://localhost:3000'},repo).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port+'/api';
 for(const path of ['/public/guides/world','/public/guides/system','/public/guides/schedule','/public/characters','/public/characters/1'])assert.equal((await fetch(url+path)).status,200);
 assert.equal((await fetch(url+'/public/characters?after=-1')).status,400);assert.equal((await fetch(url+'/public/characters/1',{method:'PATCH'})).status,404);assert.equal((await fetch(url+'/characters/1/public')).status,401);assert.equal((await fetch(url+'/admin/content/world',{method:'PATCH'})).status,401);assert.equal(reset,0);assert.equal(writes,0);
});
test('P3 public content PostgreSQL integration',{skip:!process.env.ISOLATED_PG_CONFIG},async t=>{
 const raw=createIsolatedPool(),schema='p3_'+key().replaceAll('-','');let fault=false;const sql=q=>q.replaceAll('public.',schema+'.');
 const pool={query:(q,p)=>raw.query(sql(q),p),async connect(){const c=await raw.connect();return {release:()=>c.release(),query(q,p){if(fault&&q.includes('insert into public.action_log'))throw Error('audit failure');return c.query(sql(q),p);}};}};
 const content=createPublicContentRepository(pool),characters=createInteractionRepository(pool);
 try{
 await raw.query('create schema '+schema);for(const {tablename} of (await raw.query("select tablename from pg_tables where schemaname='public'")).rows)await raw.query('create table '+schema+'.'+tablename+'(like public.'+tablename+' including all)');await pool.query('insert into public.daily_reset_state(singleton) values(true)');await raw.query('insert into '+schema+'.system_config select * from public.system_config');
 const account=async(role,status='ALIVE')=>{const c=(await pool.query("insert into public.game_character(name,hunter_grade,has_ability,ability_grade,atk,def,agi,hp,blood,status) values($1,'B',true,'E',20,20,20,$2,$3,$4) returning *",['러너 '+key(),status==='DEAD'?0:100,status==='NEAR_DEATH'?0:100,status])).rows[0];const u=(await pool.query("insert into public.auth_user(role,mastodon_instance,mastodon_account_id,character_id) values($1,'private.instance',$2,$3) returning *",[role,key(),c.id])).rows[0];return {c,u};};const admin=await account('ADMIN'),runner=await account('USER'),dead=await account('USER','DEAD'),near=await account('USER','NEAR_DEATH');
 const save=async(kind,v)=>content.saveAdminContent(admin.u.id,kind,{content:v,expectedVersion:(await content.getAdminContent(kind)).version,requestKey:key()});
 await t.test('migration idempotence preserves existing content and game start state',async()=>{
 const text=fs.readFileSync(new URL('../../supabase/migrations/20261110100000_public_guides.sql',import.meta.url),'utf8');await save('world',{title:'기존',body:'기존 본문',published:false});const before=await content.getAdminContent('world');await pool.query(text);assert.deepEqual(await content.getAdminContent('world'),before);assert.deepEqual((await pool.query('select start_date,last_completed_date from public.daily_reset_state')).rows,[{start_date:null,last_completed_date:null}]);
 });
 await t.test('world private projection, publication, conflict and audit rollback',async()=>{
 assert.equal((await content.getPublicContent('world')).content,null);let before=await content.getAdminContent('world');const v={title:'등록 제목',body:'운영진 입력\n둘째 문단',published:true};await assert.rejects(content.saveAdminContent(runner.u.id,'world',{content:v,expectedVersion:before.version,requestKey:key()}),{code:'ADMIN_REQUIRED'});
 const body={content:v,expectedVersion:before.version,requestKey:key()};await content.saveAdminContent(admin.u.id,'world',body);assert.deepEqual((await content.getPublicContent('world')).content,{title:v.title,body:v.body});await assert.rejects(content.saveAdminContent(admin.u.id,'world',body),{code:'DUPLICATE_REQUEST'});await assert.rejects(content.saveAdminContent(admin.u.id,'world',{...body,requestKey:key()}),{code:'CONTENT_CHANGED'});
 before=await content.getAdminContent('world');fault=true;await assert.rejects(save('world',{...v,published:false}),/audit failure/);fault=false;assert.deepEqual(await content.getAdminContent('world'),before);
 });
 await t.test('system only published items in configured order; simultaneous editors one wins',async()=>{
 const item=(id,order,published=true)=>({id,order,published,title:id,body:'text'});const before=await content.getAdminContent('system');const results=await Promise.allSettled([1,2].map(n=>content.saveAdminContent(admin.u.id,'system',{content:{items:[item('second',2),item('first',1),item('SECRET',0,false)]},expectedVersion:before.version,requestKey:key()})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual((await content.getPublicContent('system')).content.items.map(r=>r.id),['first','second']);assert.ok((await pool.query("select 1 from public.action_log where action_type='PUBLIC_CONTENT_UPDATE' and admin_user_id=$1",[admin.u.id])).rowCount);
 });
 await t.test('schedule uses DB clock, hides private items, does not alter daily state',async()=>{
 const now=(await pool.query('select clock_timestamp() now')).rows[0].now.getTime(),iso=n=>new Date(n).toISOString().replace('.000','').replace(/\.\d{3}Z$/,'Z');const value={title:'러닝',body:'등록 설명',published:true,startAt:iso(now-3600000),endAt:iso(now+3600000),items:[{id:'x',title:'지난 일정',body:'',published:true,order:2,startAt:'2020-01-01T00:00:00+09:00',endAt:'2020-01-02T00:00:00+09:00'},{id:'secret',title:'숨김',body:'비공개',published:false,order:0,startAt:null,endAt:null}]};await save('schedule',value);const result=await content.getPublicContent('schedule');assert.equal(result.content.state,'ONGOING');assert.equal(result.content.items.length,1);assert.equal(result.content.items[0].state,'ENDED');await save('schedule',{...value,published:false});assert.equal((await content.getPublicContent('schedule')).content,null);assert.equal((await pool.query('select start_date from public.daily_reset_state')).rows[0].start_date,null);
 });
 await t.test('guest roster explicit profile projection, search, status, no data mutation',async()=>{
 const before=(await pool.query('select * from public.game_character order by id')).rows,logs=(await pool.query('select count(*)::int n from public.action_log')).rows[0].n;
 for(const a of [runner,dead,near]){const r=await characters.getVisitorCharacter(a.c.id);assert.deepEqual(Object.keys(r).sort(),['id','name','hunter_grade','has_ability','ability_grade','status'].sort());assert.equal(r.status,a.c.status);assert.equal((await characters.listVisitorCharacters(a.c.name)).length,1);}
 await pool.query('update public.auth_user set is_active=false where id=$1',[near.u.id]);await assert.rejects(characters.getVisitorCharacter(near.c.id),{code:'CHARACTER_NOT_FOUND'});assert.equal((await characters.listVisitorCharacters(near.c.name)).length,0);
 assert.deepEqual((await pool.query('select * from public.game_character order by id')).rows,before);assert.equal((await pool.query('select count(*)::int n from public.action_log')).rows[0].n,logs);assert.equal((await characters.getPublicCharacter(dead.u.id,runner.c.id)).character.id,runner.c.id);
 });
 }finally{fault=false;await raw.query('drop schema if exists '+schema+' cascade');await raw.end();}
});

test('public content validation does not depend on a Node global Buffer in Edge',()=>{
 const saved=globalThis.Buffer;
 try{delete globalThis.Buffer;assert.deepEqual(validateContent('world',{title:'',body:'',published:false}),{title:'',body:'',published:false});assert.deepEqual(validateContent('system',{items:[]}),{items:[]});}
 finally{globalThis.Buffer=saved;}
});
