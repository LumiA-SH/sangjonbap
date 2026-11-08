import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool as createPool} from './isolated-pool.js';
import {createAdminRepository} from '../src/modules/admin/repository.js';
import {createCookingRepository} from '../src/modules/cooking/repository.js';
import {createGachaRepository} from '../src/modules/gacha/repository.js';
import {manageDevAdminMasters} from '../scripts/dev-admin-masters.js';
import {createTrainingRepository} from '../src/modules/training/repository.js';
import {createBloodPackRepository} from '../src/modules/inventory/blood-pack.js';
import {createShopRepository} from '../src/modules/shop/repository.js';

const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('admin phase 2 PostgreSQL isolated schema: masters, roles, scripts, concurrency', {skip:process.env.RUN_ADMIN_DB_TESTS!=='1'},async t=>{
    const raw=createPool(),schema=`test_admin2_${randomUUID().replaceAll('-','')}`;
    const tables=['daily_reset_state','auth_user','game_character','item','food_config','recipe','recipe_ingredient','character_recipe','gacha','gacha_reward','inventory','action_log','system_config','shop_product','shop_purchase','blood_pack_purchase_day','battle'];
    const sql=s=>s.replaceAll('public.',`${schema}.`);
    function scoped(hook,onIssued) {
        return {query:(q,p)=>raw.query(sql(q),p),async connect(){const c=await raw.connect();return {
            release:()=>c.release(),async query(q,p){const pending=c.query(sql(q),p);if(onIssued)onIssued(q);const result=await pending;if(hook)await hook(q,p,result);return result;}
        };}};
    }
    const pool=scoped();
    await raw.query(`create schema ${schema}`);
    try {
        // No public rows or roles are changed. Clone actual CHECK/default/identity definitions.
        for(const table of tables)await raw.query(`create table ${schema}.${table} (like public.${table} including all)`);
        await pool.query('insert into public.daily_reset_state(singleton) values(true)');
        const constraints=(await raw.query(`select c.conrelid::regclass::text as tbl,c.conname,pg_get_constraintdef(c.oid) as def,
            c.confrelid::regclass::text as ref from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace`)).rows;
        const c=await raw.connect();
        try {
            await c.query('begin');await c.query(`set local search_path to ${schema},public`);
            for(const row of constraints) {
                const table=row.tbl.replace('public.',''),ref=row.ref.replace('public.','');
                if(tables.includes(table)&&tables.includes(ref))await c.query(`alter table ${schema}.${table} add constraint ${row.conname} ${row.def.replaceAll('public.',`${schema}.`)}`);
            }
            await c.query('commit');
        }catch(e){await c.query('rollback');throw e;}finally{c.release();}
        await raw.query(`insert into ${schema}.system_config select * from public.system_config where config_key in ('cooking_ap_cost','permanent_stat_cap') or config_key like 'training_%'`);
        const account=async(name)=> (await pool.query("insert into public.auth_user(role,mastodon_account_id,mastodon_instance) values ('USER',$1,'example.invalid') returning *",[name])).rows[0];
        const a=await account('test-a'),b=await account('test-b'),u=await account('test-user');
        const target={id:a.id,accountId:'test-a',instance:'example.invalid'};
        const repo=createAdminRepository(pool),key=()=>randomUUID();
        const save=(kind,id,input,actor=a.id)=>repo.saveAdminMaster(actor,kind,id,input,key());
        await t.test('bootstrap nonexistent/mismatched target rejected, success audited, second call blocked',async()=>{
            await rejects(repo.bootstrapFirstAdmin({...target,id:'9223372036854775807'},key()),'USER_NOT_FOUND');
            await rejects(repo.bootstrapFirstAdmin({...target,accountId:'wrong'},key()),'BOOTSTRAP_TARGET_MISMATCH');
            assert.equal((await repo.bootstrapFirstAdmin(target,key())).role,'ADMIN');
            await rejects(repo.bootstrapFirstAdmin(target,key()),'ADMIN_ALREADY_EXISTS');
            await rejects(repo.previewFirstAdmin(target),'ADMIN_ALREADY_EXISTS');
            const log=(await pool.query("select * from public.action_log where action_type='ADMIN_BOOTSTRAP'")).rows[0];
            assert.equal(log.admin_user_id,null);assert.equal(log.detail.before.role,'USER');assert.equal(log.detail.after.role,'ADMIN');
        });
        await t.test('role grant/revoke, non-admin, self/last, duplicate, concurrent reciprocal revocation',async()=>{
            await rejects(repo.changeAdminRole(u.id,b.id,'ADMIN',key()),'ADMIN_REQUIRED');
            await rejects(repo.changeAdminRole(a.id,a.id,'USER',key()),'LAST_ADMIN');
            const requestKey=key();await repo.changeAdminRole(a.id,b.id,'ADMIN',requestKey);
            await rejects(repo.changeAdminRole(a.id,u.id,'ADMIN',requestKey),'DUPLICATE_REQUEST');
            await rejects(repo.changeAdminRole(a.id,a.id,'USER',key()),'SELF_REVOKE_FORBIDDEN');
            const results=await Promise.allSettled([repo.changeAdminRole(a.id,b.id,'USER',key()),repo.changeAdminRole(b.id,a.id,'USER',key())]);
            assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
            assert.equal(Number((await pool.query("select count(*) from public.auth_user where role='ADMIN' and is_active")).rows[0].count),1);
            const survivor=(await pool.query("select id from public.auth_user where role='ADMIN'")).rows[0].id;
            if(survivor!==a.id)await repo.changeAdminRole(survivor,a.id,'ADMIN',key());
            else await repo.changeAdminRole(a.id,b.id,'ADMIN',key());
            const audit=(await pool.query("select detail from public.action_log where action_type='USER_ROLE_CHANGE'")).rows;
            assert.ok(audit.every(r=>r.detail.actor.id&&r.detail.targetUserId&&r.detail.before&&r.detail.after));
            const search=await repo.searchAdminUsers(u.id);assert.equal(search.length,1);assert.equal(search[0].mastodon_account_id,undefined);
        });
        const item=async(name,category)=>repo.saveAdminRecord(a.id,'items',null,{name,category},key());
        const material=await item('DEV isolated material','MATERIAL'),food=await item('DEV isolated food','FOOD'),failure=await item('DEV isolated failure','FOOD');
        await t.test('admin literal name search returns IDs/category and escapes wildcard semantics',async()=>{
            const found=await repo.searchAdminItems('isolated');assert.ok(found.some(r=>r.id===material.id&&r.category==='MATERIAL'));
            assert.deepEqual(await repo.searchAdminItems('%'),[]);
        });
        let recipe,gacha;
        await t.test('food disabled/enabled constraints, partial updates, percentage and audit',async()=>{
            await rejects(save('foods',null,{item_id:food.id},u.id),'ADMIN_REQUIRED');
            let row=await save('foods',null,{item_id:food.id,blood_recovery:7});
            assert.equal(row.stat_growth_target,null);
            await rejects(save('foods',food.id,{stat_growth_enabled:true}),'INVALID_ADMIN_INPUT');
            row=await save('foods',food.id,{stat_growth_enabled:true,stat_growth_target:'ATK',stat_growth_value:2,stat_growth_rate:50.5});
            assert.equal(row.stat_growth_rate,50.5);
            await rejects(save('foods',food.id,{stat_growth_enabled:false}),'INVALID_ADMIN_INPUT');
            await save('foods',food.id,{stat_growth_enabled:false,stat_growth_target:null,stat_growth_value:0});
            await assert.rejects(pool.query('update public.food_config set stat_growth_value=1 where item_id=$1',[food.id]),e=>e.code==='23514');
            const log=(await pool.query("select detail from public.action_log where action_type='FOOD_CONFIG_UPDATE' order by id desc limit 1")).rows[0].detail;
            assert.equal(log.before.stat_growth_enabled,true);assert.equal(log.after.stat_growth_value,0);
        });
        await t.test('recipe ingredients + gacha rewards create/update/list/detail and probability',async()=>{
            recipe=await save('recipes',null,{name:'DEV recipe',success_rate:100,result_item_id:food.id,failure_item_id:failure.id,ingredients:[{item_id:material.id,quantity:2}]});
            assert.equal(recipe.result_quantity,4);
            recipe=await save('recipes',recipe.id,{learn_cost:1,ingredients:[{item_id:material.id,quantity:3}]});
            assert.equal(recipe.ingredients[0].quantity,3);
            await rejects(save('recipes',recipe.id,{ingredients:[{item_id:'9223372036854775807',quantity:1}]}),'ITEM_NOT_FOUND');
            assert.equal((await repo.getAdminMaster('recipes',recipe.id)).ingredients[0].quantity,3);
            gacha=await save('gachas',null,{name:'DEV gacha',price:1,rewards:[{item_id:food.id,quantity:1,weight:1},{item_id:failure.id,quantity:2,weight:3}]});
            assert.deepEqual(gacha.rewards.map(r=>r.probability),[25,75]);
            assert.equal((await repo.listAdminMasters('gachas'))[0].id,gacha.id);
            await rejects(save('gachas',gacha.id,{start_at:'2026-10-12T00:00:00Z',end_at:'2026-10-11T00:00:00Z'}),'INVALID_ADMIN_INPUT');
            const timed=await save('gachas',gacha.id,{start_at:'2026-10-11T00:00:00.000001Z',end_at:'2026-10-11T00:00:00.000002Z'});
            assert.equal(timed.start_at,'2026-10-11T00:00:00.000001Z');assert.equal(timed.end_at,'2026-10-11T00:00:00.000002Z');
            await save('gachas',gacha.id,{start_at:null,end_at:null});
        });
        await t.test('audit failure rolls back parent, nested children, and role; duplicate writes rollback',async()=>{
            const fault=createAdminRepository(scoped(q=>{if(q.includes('insert into public.action_log'))throw new Error('injected audit failure');}));
            for(const [kind,row,patch] of [['recipes',recipe,{name:'rollback',ingredients:[{item_id:material.id,quantity:9}]}],['gachas',gacha,{price:99,rewards:[{item_id:food.id,quantity:9,weight:1}]}]]){
                const before=await repo.getAdminMaster(kind,row.id);
                await assert.rejects(fault.saveAdminMaster(a.id,kind,row.id,patch,key()),/injected/);
                assert.deepEqual(await repo.getAdminMaster(kind,row.id),before);
            }
            await assert.rejects(fault.changeAdminRole(a.id,u.id,'ADMIN',key()),/injected/);
            assert.equal((await pool.query('select role from public.auth_user where id=$1',[u.id])).rows[0].role,'USER');
            const k=key();await repo.saveAdminMaster(a.id,'gachas',gacha.id,{price:2},k);
            await rejects(repo.saveAdminMaster(a.id,'gachas',gacha.id,{price:9},k),'DUPLICATE_REQUEST');
        });
        const character=(await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,currency) values ('DEV isolated','B',5,5,5,1000) returning *")).rows[0];
        await pool.query('update public.auth_user set character_id=$1 where id=$2',[character.id,u.id]);
        await pool.query('insert into public.character_recipe(character_id,recipe_id) values ($1,$2)',[character.id,recipe.id]);
        await pool.query('insert into public.inventory(character_id,item_id,quantity) values ($1,$2,100)',[character.id,material.id]);
        await t.test('COOK holds recipe snapshot while admin replaces ingredients, learned recipe preserved',async()=>{
            const locked=deferred(),release=deferred(),editing=deferred();
            const cooking=createCookingRepository(scoped(async q=>{if(q==='select * from public.recipe where id=$1 for share'){locked.resolve();await release.promise;}}),{random:()=>0});
            const play=cooking.cookRecipe(u.id,recipe.id,key());await locked.promise;
            const editor=createAdminRepository(scoped(null,q=>{if(q==='select id from public.recipe where id=$1 for update')editing.resolve();}));
            const edit=editor.saveAdminMaster(a.id,'recipes',recipe.id,{ingredients:[{item_id:material.id,quantity:7}]},key());
            await editing.promise;
            release.resolve();const [result,updated]=await Promise.all([play,edit]);
            assert.equal(result.consumed[0].quantity,3);assert.equal(result.output.quantity,4);assert.equal(updated.ingredients[0].quantity,7);
            assert.equal((await pool.query('select * from public.character_recipe where character_id=$1',[character.id])).rowCount,1);
        });
        await t.test('DRAW uses one price/reward snapshot while admin replaces composition, history preserved',async()=>{
            const locked=deferred(),release=deferred(),editing=deferred();
            const draws=createGachaRepository(scoped(async q=>{if(q==='select * from public.gacha where id=$1 for share'){locked.resolve();await release.promise;}}),{random:()=>0});
            const play=draws.drawGacha(u.id,gacha.id,key());await locked.promise;
            const editor=createAdminRepository(scoped(null,q=>{if(q==='select id from public.gacha where id=$1 for update')editing.resolve();}));
            const edit=editor.saveAdminMaster(a.id,'gachas',gacha.id,{price:5,rewards:[{item_id:material.id,quantity:4,weight:1}]},key());
            await editing.promise;
            release.resolve();const [result]=await Promise.all([play,edit]);
            assert.equal(result.price,2);assert.equal(result.reward.itemId,food.id);
            const next=await createGachaRepository(pool,{random:()=>0}).drawGacha(u.id,gacha.id,key());
            assert.equal(next.price,5);assert.equal(next.reward.itemId,material.id);
            assert.equal((await pool.query("select * from public.action_log where action_type='GACHA_DRAW'")).rowCount,2);
        });
        await t.test('empty/nonpositive and inactive reward configurations cannot draw',async()=>{
            await rejects(save('gachas',gacha.id,{rewards:[]}),'INVALID_ADMIN_INPUT');
            await rejects(save('gachas',gacha.id,{rewards:[{item_id:food.id,quantity:1,weight:0}]}),'INVALID_ADMIN_INPUT');
            await repo.saveAdminRecord(a.id,'items',material.id,{is_active:false},key());
            await rejects(createGachaRepository(pool).drawGacha(u.id,gacha.id,key()),'GACHA_ITEM_UNAVAILABLE');
            await repo.saveAdminRecord(a.id,'items',material.id,{is_active:true},key());
        });
        await t.test('training: concurrent daily requests, great growth clamp, full cap reward, state and config rollback',async()=>{
            const training=createTrainingRepository(pool,{random:()=>0});
            await pool.query("update public.game_character set atk=39,def=40,agi=40,ap=0,status='ALIVE',blood=10 where id=$1",[character.id]);
            const results=await Promise.allSettled([training.trainCharacter(u.id,key()),training.trainCharacter(u.id,key())]);
            assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
            const won=results.find(r=>r.status==='fulfilled').value;assert.equal(won.growth.stat,'atk');assert.equal(won.growth.growth,1);assert.equal(won.ap,0);assert.equal(won.reward,1);
            await pool.query('update public.game_character set last_training_date=null where id=$1',[character.id]);
            const capped=await training.trainCharacter(u.id,key());assert.equal(capped.growth,null);assert.equal(capped.reward,1);
            await pool.query("update public.game_character set last_training_date=null,status='NEAR_DEATH',blood=0 where id=$1",[character.id]);
            await rejects(training.trainCharacter(u.id,key()),'CHARACTER_NEAR_DEATH');
            await pool.query("update public.game_character set status='DEAD',hp=0 where id=$1",[character.id]);
            await rejects(training.trainCharacter(u.id,key()),'CHARACTER_DEAD');
            await pool.query("update public.game_character set status='ALIVE',hp=100,blood=10,atk=10 where id=$1",[character.id]);
            const faulty=createTrainingRepository(scoped(q=>{if(q.includes('insert into public.action_log'))throw new Error('injected');}),{random:()=>0.9});
            await assert.rejects(faulty.trainCharacter(u.id,key()),/injected/);
            assert.equal((await pool.query('select last_training_date from public.game_character where id=$1',[character.id])).rows[0].last_training_date,null);
            const normalKey=key(),normal=await createTrainingRepository(pool,{random:()=>0.9}).trainCharacter(u.id,normalKey);assert.equal(normal.growth.growth,1);assert.equal(normal.great,false);
            await rejects(training.trainCharacter(u.id,normalKey),'DUPLICATE_REQUEST');
            for(const [grade,rate] of [['B',25],['A',15],['S',10]]) {
                for(const [roll,expected] of [[(rate-1)/100,true],[rate/100,false]]) {
                    await pool.query('update public.game_character set hunter_grade=$1,atk=10,def=40,agi=40,last_training_date=null where id=$2',[grade,character.id]);
                    const result=await createTrainingRepository(pool,{random:()=>roll}).trainCharacter(u.id,key());
                    assert.equal(result.great,expected);assert.equal(result.growth.growth,expected?2:1);
                }
            }
            await pool.query('update public.game_character set last_training_date=null where id=$1',[character.id]);
            await pool.query("update public.system_config set config_value='\"invalid\"'::jsonb where config_key='training_currency_reward'");
            await rejects(training.trainCharacter(u.id,key()),'SYSTEM_CONFIG_INVALID');
            await pool.query("update public.system_config set config_value='1'::jsonb where config_key='training_currency_reward'");
            await pool.query("delete from public.system_config where config_key='training_ap_cost'");
            await rejects(training.trainCharacter(u.id,key()),'SYSTEM_CONFIG_MISSING');
            await pool.query("insert into public.system_config(config_key,config_value) values ('training_ap_cost','0'::jsonb)");
        });
        await t.test('admin blood pack setup -> shared daily purchase -> near-death use, transfer, rollback',async()=>{
            const pack=await repo.saveAdminRecord(a.id,'items',null,{name:'DEV explicit effect',category:'CONSUMABLE',effect_type:'BLOOD_PACK',effect_value:30,usable:true,use_target:'SELF',transferable:true},key());
            await rejects(repo.saveAdminRecord(a.id,'products',null,{item_id:pack.id,price:1,daily_limit:1},key()),'BLOOD_PACK_CONFIG_INVALID');
            const product=await repo.saveAdminRecord(a.id,'products',null,{item_id:pack.id,price:0,daily_limit:1},key());
            const other=await repo.saveAdminRecord(a.id,'products',null,{item_id:pack.id,price:0,daily_limit:1},key());
            await pool.query("update public.game_character set blood=0,status='NEAR_DEATH' where id=$1",[character.id]);
            const shop=createShopRepository(pool),packs=createBloodPackRepository(pool);
            const results=await Promise.allSettled([shop.buyProduct(u.id,product.id,1,key()),shop.buyProduct(u.id,other.id,1,key())]);
            assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
            assert.equal((await shop.getShopProducts(u.id)).find(p=>p.id===product.id).dailyRemaining,0);
            const usedKey=key(),used=await packs.useBloodPack(u.id,pack.id,usedKey);
            assert.equal(used.blood,30);assert.equal(used.status,'ALIVE');
            await rejects(packs.useBloodPack(u.id,pack.id,usedKey),'DUPLICATE_REQUEST');
            await rejects(shop.buyProduct(u.id,product.id,1,key()),'DAILY_LIMIT_EXCEEDED');
            await pool.query("update public.blood_pack_purchase_day set purchase_date=purchase_date-1 where character_id=$1",[character.id]);
            await pool.query("update public.shop_purchase set purchase_date=purchase_date-1 where character_id=$1",[character.id]);
            await shop.buyProduct(u.id,product.id,1,key());
            const recipient=(await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,blood,status) values ('DEV recipient','B',12,12,12,0,'NEAR_DEATH') returning id")).rows[0].id;
            await packs.transferBloodPack(u.id,recipient,pack.id,1,key());
            assert.equal((await pool.query('select quantity from public.inventory where character_id=$1 and item_id=$2',[recipient,pack.id])).rows[0].quantity,1);
            await pool.query('insert into public.inventory(character_id,item_id,quantity) values ($1,$2,2) on conflict(character_id,item_id) do update set quantity=2',[character.id,pack.id]);
            const faulty=createBloodPackRepository(scoped(q=>{if(q.includes('insert into public.action_log'))throw new Error('injected');}));
            await assert.rejects(faulty.useBloodPack(u.id,pack.id,key()),/injected/);
            assert.equal((await pool.query('select quantity from public.inventory where character_id=$1 and item_id=$2',[character.id,pack.id])).rows[0].quantity,2);
            await pool.query("update public.game_character set hp=0,status='DEAD' where id=$1",[character.id]);
            await rejects(packs.useBloodPack(u.id,pack.id,key()),'CHARACTER_DEAD');
            await rejects(shop.buyProduct(u.id,other.id,1,key()),'CHARACTER_DEAD');
        });
        await t.test('DEV seed requires ADMIN, is idempotent, cleanup only deactivates owned IDs',async()=>{
            const c=await pool.connect(),config={nodeEnv:'development',provider:'dev',mode:'supabase'};
            try {
                await c.query('begin');
                await rejects(manageDevAdminMasters(c,config,u.id),'ADMIN_REQUIRED');
                await c.query('rollback');await c.query('begin');
                const first=await manageDevAdminMasters(c,config,a.id);
                const second=await manageDevAdminMasters(c,config,a.id);assert.deepEqual(second.ids,first.ids);
                await manageDevAdminMasters(c,config,a.id,{deactivate:true});
                const own=(await c.query('select is_active from public.item where id=any($1::bigint[])',[first.ids.items])).rows;
                assert.ok(own.every(r=>!r.is_active));
                assert.equal((await c.query('select is_active from public.item where id=$1',[food.id])).rows[0].is_active,true);
                await c.query('rollback');
            }catch(e){await c.query('rollback');throw e;}finally{c.release();}
        });
    } finally {
        // schema is generated above, never derived from user input or an existing schema.
        await raw.query(`drop schema ${schema} cascade`);await raw.end();
    }
});
