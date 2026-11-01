import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createPool} from '../src/db/pool.js';
import {loadConfig} from '../src/config/env.js';
import {createInvestigationRepository} from '../src/modules/investigation/repository.js';
import {createBattleRepository} from '../src/modules/battle/repository.js';
import {createShopRepository} from '../src/modules/shop/repository.js';
import {createCookingRepository} from '../src/modules/cooking/repository.js';
import {lockCharacterByUser} from '../src/shared/game.js';

test('recipe discovery isolated PostgreSQL: global uniqueness, integration and rollback', {skip:process.env.RUN_RECIPE_DB_TESTS!=='1'},async t=>{
    const raw=createPool(loadConfig()),schema='test_recipe_'+randomUUID().replaceAll('-','');
    assert.match(schema,/^test_recipe_[a-f0-9]{32}$/);
    const rewrite=q=>q.replaceAll('public.',schema+'.');
    let fail=false;
    const pool={query:(q,p)=>raw.query(rewrite(q),p),async connect(){const c=await raw.connect();return {release:()=>c.release(),query(q,p){
        if(fail&&q.includes('insert into public.action_log')&&p?.[3]===fail)throw Error('injected final log failure');
        return c.query(rewrite(q),p);
    }};}};
    const tables=['auth_user','game_character','item','inventory','action_log','system_config','recipe','recipe_ingredient','character_recipe','food_config',
        'shop_product','shop_purchase','blood_pack_purchase_day','area','investigation_result','investigation_reward','unique_discovery','clue',
        'monster','monster_action','monster_drop','area_monster','battle','battle_log','gacha'];
    const migrated=(await raw.query("select to_regclass('public.recipe_discovery') is not null as ready")).rows[0].ready;
    if(migrated)tables.push('recipe_discovery');
    await raw.query(`create schema ${schema}`);
    try {
        for(const name of tables)await raw.query(`create table ${schema}.${name} (like public.${name} including all)`);
        const constraints=(await raw.query("select conrelid::regclass::text tbl,confrelid::regclass::text ref,conname,pg_get_constraintdef(oid) def from pg_constraint where contype='f' and connamespace='public'::regnamespace")).rows;
        const ddl=await raw.connect();
        try {
            await ddl.query('begin');await ddl.query(`set local search_path to ${schema},public`);
            for(const r of constraints)if(tables.includes(r.tbl.replace('public.',''))&&tables.includes(r.ref.replace('public.','')))
                await ddl.query(`alter table ${schema}.${r.tbl.replace('public.','')} add constraint ${r.conname} ${rewrite(r.def)}`);
            await ddl.query('commit');
        }catch(e){await ddl.query('rollback');throw e;}finally{ddl.release();}
        await raw.query(`insert into ${schema}.system_config select * from public.system_config`);
        await pool.query(readFileSync(new URL('../../supabase/migrations/20261101032815_common_rules_v02.sql',import.meta.url),'utf8'));
        const item=(await pool.query("insert into public.item(name,category) values('isolated ingredient','MATERIAL') returning *")).rows[0];
        const food=(await pool.query("insert into public.item(name,category) values('isolated food','FOOD') returning *")).rows[0];
        const users=[];
        for(let i=0;i<5;i++) {
            const c=(await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,currency,ap,max_ap) values($1,'B',20,8,8,100,50,50) returning *",['isolated recipe '+i])).rows[0];
            const u=(await pool.query("insert into public.auth_user(character_id,role) values($1,'USER') returning *",[c.id])).rows[0];
            users.push({u,c});
        }
        const legacy=(await pool.query('insert into public.recipe(name,success_rate,result_item_id,result_quantity) values($1,100,$2,4) returning *',['legacy learned',food.id])).rows[0];
        await pool.query('insert into public.character_recipe(character_id,recipe_id) values($1,$2)',[users[0].c.id,legacy.id]);
        if(!migrated)await pool.query(readFileSync(new URL('../../supabase/migrations/20261101091456_recipe_first_discovery.sql',import.meta.url),'utf8'));
        const inv=createInvestigationRepository(pool,{random:()=>0}),shop=createShopRepository(pool),cook=createCookingRepository(pool,{random:()=>0}),battle=createBattleRepository(pool,{random:()=>0});
        const recipe=async(grade='COMMON')=>{
            const r=(await pool.query(`insert into public.recipe(name,discovery_grade,learn_cost,success_rate,result_item_id,result_quantity,failure_item_id)
                values('new recipe',$1,99,100,$2,4,$2) returning *`,[grade,food.id])).rows[0];
            await pool.query('insert into public.recipe_ingredient(recipe_id,item_id,quantity) values($1,$2,2)',[r.id,item.id]);return r;
        };
        const source=async r=>{
            const a=(await pool.query("insert into public.area(name,is_open,encounter_rate) values('recipe area',true,0) returning *")).rows[0];
            const result=(await pool.query(`insert into public.investigation_result(area_id,result_grade,result_text,weight,is_unique,investigation_rate_value)
                values($1,'NORMAL','recipe clue',1,true,5) returning *`,[a.id])).rows[0];
            await pool.query('insert into public.investigation_reward(investigation_result_id,recipe_id,quantity,probability) values($1,$2,1,100)',[result.id,r.id]);
            return a;
        };
        const inspect=async id=>(await pool.query('select * from public.game_character where id=$1',[id])).rows[0];
        const rejects=(p,code)=>assert.rejects(p,e=>e.code===code);
        const discover=async(r,user=users[0])=>{const a=await source(r);return inv.investigate(user.u.id,a.id,randomUUID());};

        await t.test('migration preserves old ownership without inferring discovery or grade',async()=>{
            assert.equal((await pool.query('select * from public.recipe_discovery')).rowCount,0);
            assert.equal((await pool.query('select * from public.character_recipe')).rowCount,1);
            const catalog=await cook.getCookingCatalog(users[0].u.id);
            assert.equal(catalog.recipes[0].id,legacy.id);assert.equal(catalog.recipes[0].learned,true);assert.equal(catalog.recipes[0].discovery_grade,null);
        });
        await t.test('free discovery, separate result unique, exact grade prices and duplicate exclusion',async()=>{
            for(const [grade,price] of [['COMMON',1],['RARE',2],['SPECIAL',3]]) {
                const r=await recipe(grade),a=await source(r),key=randomUUID(),before=await inspect(users[0].c.id);
                const first=await inv.investigate(users[0].u.id,a.id,key);
                assert.equal(first.firstDiscovery,true);assert.equal(first.area.investigation_rate,5);
                assert.equal(first.rewards[0].firstDiscovery,true);assert.equal(first.rewards[0].price,price);
                assert.equal((await inspect(users[0].c.id)).currency,before.currency);
                const product=(await shop.getShopProducts(users[1].u.id)).find(p=>p.recipe_id===r.id);
                assert.equal(product.price,price);assert.equal(product.learned,false);
                await rejects(inv.investigate(users[0].u.id,a.id,key),'DUPLICATE_REQUEST');
                const repeat=await inv.investigate(users[1].u.id,a.id,randomUUID());
                assert.equal(repeat.firstDiscovery,false);assert.equal(repeat.area.investigation_rate,5);assert.deepEqual(repeat.rewards,[]);
                const buyerBefore=await inspect(users[1].c.id);
                const bought=await shop.buyProduct(users[1].u.id,product.id,1,randomUUID());
                assert.equal(bought.currency,buyerBefore.currency-price);assert.equal(bought.learned,true);
                await rejects(shop.buyProduct(users[1].u.id,product.id,1,randomUUID()),'RECIPE_ALREADY_LEARNED');
                await rejects(shop.buyProduct(users[0].u.id,product.id,1,randomUUID()),'RECIPE_ALREADY_LEARNED');
            }
        });
        await t.test('concurrent discoveries in different areas elect exactly one and register once',async()=>{
            const r=await recipe(),a=await source(r),b=await source(r);
            const results=await Promise.all([inv.investigate(users[0].u.id,a.id,randomUUID()),inv.investigate(users[1].u.id,b.id,randomUUID())]);
            assert.equal(results.flatMap(x=>x.rewards).length,1);
            assert.equal((await pool.query('select 1 from public.recipe_discovery where recipe_id=$1',[r.id])).rowCount,1);
            assert.equal((await pool.query('select 1 from public.shop_product where recipe_id=$1',[r.id])).rowCount,1);
            assert.equal((await pool.query('select 1 from public.character_recipe where recipe_id=$1',[r.id])).rowCount,1);
            assert.equal(results.filter(x=>x.firstDiscovery).length,2); // Separate result discoveries remain independent.
        });
        await t.test('rollback includes AP, result progress, free learning, product and both logs',async()=>{
            const r=await recipe(),a=await source(r),before=await inspect(users[0].c.id),key=randomUUID();
            fail='INVESTIGATE';await assert.rejects(inv.investigate(users[0].u.id,a.id,key),/injected final log failure/);fail=false;
            assert.equal((await inspect(users[0].c.id)).ap,before.ap);
            for(const table of ['recipe_discovery','shop_product','character_recipe'])assert.equal((await pool.query(`select 1 from public.${table} where recipe_id=$1`,[r.id])).rowCount,0);
            assert.equal(Number((await pool.query('select investigation_rate from public.area where id=$1',[a.id])).rows[0].investigation_rate),0);
            assert.equal((await inv.investigate(users[0].u.id,a.id,key)).rewards.length,1);
        });
        await t.test('legacy learn endpoint uses shop transaction; concurrent purchases and UUID never charge twice',async()=>{
            const r=await recipe('RARE');await discover(r);
            const before=await inspect(users[2].c.id),key=randomUUID();
            const results=await Promise.allSettled([cook.learnRecipe(users[2].u.id,r.id,key),cook.learnRecipe(users[2].u.id,r.id,key)]);
            assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
            assert.equal((await inspect(users[2].c.id)).currency,before.currency-2);
            await rejects(cook.learnRecipe(users[2].u.id,r.id,randomUUID()),'RECIPE_ALREADY_LEARNED');
            const hidden=await recipe();await rejects(cook.learnRecipe(users[2].u.id,hidden.id,randomUUID()),'RECIPE_NOT_DISCOVERED');
        });
        await t.test('legacy ownership does not force a first finder; missing grade holds atomically',async()=>{
            const a=await source(legacy);
            await rejects(inv.investigate(users[1].u.id,a.id,randomUUID()),'RECIPE_LEGACY_DISCOVERY_HOLD');
            assert.equal((await pool.query('select 1 from public.recipe_discovery where recipe_id=$1',[legacy.id])).rowCount,0);
            const unset=await recipe(null),sourceUnset=await source(unset);
            await rejects(inv.investigate(users[1].u.id,sourceUnset.id,randomUUID()),'RECIPE_GRADE_HOLD');
        });
        await t.test('recipe purchase rollback, near-death eligibility and different-key concurrency',async()=>{
            const r=await recipe();await discover(r);
            const p=(await pool.query('select * from public.shop_product where recipe_id=$1',[r.id])).rows[0],u=users[4];
            await rejects(shop.buyProduct(u.u.id,p.id,2,randomUUID()),'RECIPE_PURCHASE_QUANTITY');
            const before=await inspect(u.c.id),key=randomUUID();
            fail='SHOP_PURCHASE';await assert.rejects(shop.buyProduct(u.u.id,p.id,1,key),/injected final log failure/);fail=false;
            assert.equal((await inspect(u.c.id)).currency,before.currency);
            assert.equal((await pool.query('select 1 from public.character_recipe where character_id=$1 and recipe_id=$2',[u.c.id,r.id])).rowCount,0);
            assert.equal((await pool.query('select 1 from public.shop_purchase where request_key=$1',[key])).rowCount,0);
            await pool.query("update public.game_character set status='DEAD',hp=0 where id=$1",[u.c.id]);
            await rejects(shop.buyProduct(u.u.id,p.id,1,key),'CHARACTER_DEAD');
            await pool.query("update public.game_character set status='NEAR_DEATH',hp=100,blood=0,currency=0 where id=$1",[u.c.id]);
            await rejects(shop.buyProduct(u.u.id,p.id,1,key),'NOT_ENOUGH_CURRENCY');
            await pool.query('update public.game_character set currency=10 where id=$1',[u.c.id]);
            const results=await Promise.allSettled([shop.buyProduct(u.u.id,p.id,1,key),shop.buyProduct(u.u.id,p.id,1,randomUUID())]);
            assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
            assert.equal((await inspect(u.c.id)).currency,9);assert.equal((await inspect(u.c.id)).status,'NEAR_DEATH');
            await pool.query("update public.game_character set status='ALIVE',blood=100 where id=$1",[u.c.id]);
        });
        await t.test('ordinary shop and single cooking success/failure remain unchanged',async()=>{
            const r=await recipe();await discover(r,users[3]);
            const p=(await pool.query('insert into public.shop_product(item_id,price) values($1,2) returning *',[item.id])).rows[0];
            const bought=await shop.buyProduct(users[3].u.id,p.id,4,randomUUID());assert.equal(bought.totalPrice,8);
            const cooked=await cook.cookRecipe(users[3].u.id,r.id,randomUUID());
            assert.equal(cooked.output.quantity,4);assert.equal(cooked.consumed[0].quantity,2);assert.equal(cooked.apCost,1);
            await pool.query('update public.recipe set success_rate=0 where id=$1',[r.id]);
            const failed=await cook.cookRecipe(users[3].u.id,r.id,randomUUID());
            assert.equal(failed.succeeded,false);assert.equal(failed.output.quantity,1);assert.equal(failed.consumed[0].quantity,1);
            await pool.query(`insert into public.food_config(item_id,blood_recovery,stat_growth_enabled,stat_growth_rate,stat_growth_target,stat_growth_value)
                values($1,10,false,0,null,0)`,[food.id]);
            await pool.query('update public.game_character set blood=20 where id=$1',[users[3].c.id]);
            const eaten=await cook.eatFood(users[3].u.id,food.id,randomUUID());
            assert.equal(eaten.blood,30);assert.equal(eaten.dailyMealCount,1);assert.equal(eaten.growth,null);
        });
        await t.test('PVE snapshots exclude discovered recipes and settlement rechecks live state',async()=>{
            const r=await recipe('SPECIAL');
            const a=(await pool.query("insert into public.area(name,is_open,encounter_rate) values('battle recipe',true,100) returning *")).rows[0];
            const m=(await pool.query("insert into public.monster(name,max_hp,atk,def,agi) values('recipe monster',1,1,0,0) returning *")).rows[0];
            await pool.query('insert into public.area_monster(area_id,monster_id,weight) values($1,$2,1)',[a.id,m.id]);
            await pool.query("insert into public.monster_action(monster_id,name,action_type,probability,multiplier) values($1,'attack','ATTACK',100,1)",[m.id]);
            await pool.query('insert into public.monster_drop(monster_id,recipe_id,drop_rate) values($1,$2,100)',[m.id,r.id]);
            const start=async user=>{
                const c=await pool.connect();try {await c.query('begin');const pc=await lockCharacterByUser(c,user.u.id);
                    const b=await battle.encounter(c,a,pc);await c.query('commit');return b;
                }catch(e){await c.query('rollback');throw e;}finally{c.release();}
            };
            const b1=await start(users[0]),b2=await start(users[1]);
            const command=(u,b)=>battle.commandBattle(u.u.id,b.id,{requestKey:randomUUID(),turnNo:1,action:'ATTACK'});
            const results=await Promise.all([command(users[0],b1),command(users[1],b2)]);
            assert.equal(results.flatMap(x=>x.rewards).length,1);
            assert.ok(results.every(x=>x.battle.battle_status==='VICTORY'));
            const next=await start(users[2]);
            const snap=(await pool.query('select snapshot from public.battle where id=$1',[next.id])).rows[0].snapshot;
            assert.equal(snap.drops.length,0);
            await rejects(shop.buyProduct(users[2].u.id,(await pool.query('select id from public.shop_product where recipe_id=$1',[r.id])).rows[0].id,1,randomUUID()),'BATTLE_ACTIVE');
            const cross=await recipe();
            await pool.query('insert into public.monster_drop(monster_id,recipe_id,drop_rate) values($1,$2,100)',[m.id,cross.id]);
            const crossBattle=await start(users[3]),crossArea=await source(cross);
            const crossResults=await Promise.all([command(users[3],crossBattle),inv.investigate(users[4].u.id,crossArea.id,randomUUID())]);
            assert.equal(crossResults.flatMap(x=>x.rewards).filter(x=>x.recipeId===cross.id).length,1);
        });
    } finally {await raw.query(`drop schema ${schema} cascade`);await raw.end();}
});
