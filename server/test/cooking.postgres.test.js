import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool as createPool} from './isolated-pool.js';
import {createCookingRepository} from '../src/modules/cooking/repository.js';

test('PostgreSQL cooking and meals with isolated fixtures', {skip: process.env.RUN_COOKING_DB_TESTS !== '1'}, async t => {
    const pool = createPool();
    const items = [], characters = [], users = [];
    let recipeId, setupDone = false;
    const setup = await pool.connect();
    try {
        await setup.query('begin');
        for (let n = 0; n < 2; n++) {
            const c = (await setup.query("insert into public.game_character(name,hunter_grade,atk,def,agi,currency,max_blood) values ($1,'B',5,5,5,100,100) returning id", [`DEV cooking test ${randomUUID()}`])).rows[0];
            characters.push(c.id);
            users.push((await setup.query("insert into public.auth_user(character_id,role) values ($1,'USER') returning id", [c.id])).rows[0].id);
        }
        for (let n = 0; n < 4; n++) items.push((await setup.query("insert into public.item(name,category) values ($1,'ETC') returning id", [`DEV cooking item ${randomUUID()}`])).rows[0].id);
        await setup.query("insert into public.food_config(item_id,blood_recovery,stat_growth_enabled,stat_growth_rate,stat_growth_target,stat_growth_value) values ($1,30,true,100,'ATK',3)", [items[2]]);
        await setup.query('insert into public.food_config(item_id,blood_recovery) values ($1,5)', [items[3]]);
        recipeId = (await setup.query(`insert into public.recipe(name,discovery_grade,learn_cost,success_rate,result_item_id,failure_item_id) values ($1,'COMMON',10,100,$2,$3) returning id`, [`DEV cooking recipe ${randomUUID()}`, items[2], items[3]])).rows[0].id;
        await setup.query('insert into public.recipe_ingredient(recipe_id,item_id,quantity) values ($1,$2,3),($1,$3,1)', [recipeId,items[0],items[1]]);
        await setup.query("insert into public.recipe_discovery(recipe_id,character_id,source_type,source_id) values($1,$2,'INVESTIGATION',1)",[recipeId,characters[1]]);
        await setup.query('insert into public.shop_product(recipe_id,price,purchase_limit) values($1,1,1)',[recipeId]);
        await setup.query('commit');
        setupDone = true;
    } catch (e) { await setup.query('rollback'); throw e; }
    finally { setup.release(); if (!setupDone) await pool.end(); }
    const repo = createCookingRepository(pool, {random: () => 0.25});
    const learn = (key = randomUUID(), i = 0) => repo.learnRecipe(users[i],recipeId,key);
    const cook = (key = randomUUID(), i = 0) => repo.cookRecipe(users[i],recipeId,key);
    const eat = (key = randomUUID(), i = 0, item = items[2]) => repo.eatFood(users[i],item,key);
    const rejects = (promise,code) => assert.rejects(promise,e => e.code === code);
    const get = async () => (await pool.query('select * from public.game_character where id=$1',[characters[0]])).rows[0];
    const snapshot = async () => ({character: await get(),
        inventory: (await pool.query('select item_id,quantity from public.inventory where character_id=$1 order by item_id',[characters[0]])).rows,
        learned: (await pool.query('select * from public.character_recipe where character_id=$1',[characters[0]])).rows,
        logs: (await pool.query('select id from public.action_log where character_id=$1 order by id',[characters[0]])).rows});
    async function scenario(name, fn) {
        await t.test(name, async () => {
            await pool.query('delete from public.action_log where character_id=any($1::bigint[])',[characters]);
            await pool.query('delete from public.shop_purchase where character_id=any($1::bigint[])',[characters]);
            await pool.query('delete from public.character_recipe where character_id=any($1::bigint[])',[characters]);
            await pool.query('delete from public.inventory where character_id=any($1::bigint[])',[characters]);
            await pool.query("update public.game_character set currency=100,ap=10,hp=100,blood=50,status='ALIVE',daily_meal_count=0,atk=5,def=5,agi=5 where id=any($1::bigint[])",[characters]);
            await pool.query('update public.recipe set success_rate=100,result_quantity=3,failure_item_id=$2,is_active=true where id=$1',[recipeId,items[3]]);
            await pool.query("update public.food_config set blood_recovery=30,stat_growth_enabled=true,stat_growth_rate=100,stat_growth_target='ATK',stat_growth_value=3 where item_id=$1",[items[2]]);
            for (const c of characters) await pool.query('insert into public.inventory(character_id,item_id,quantity) select $1,unnest($2::bigint[]),10',[c,items]);
            await fn();
        });
    }
    try {
        await scenario('learn charges once and catalog shows learning; repeated learning/key rejected', async () => {
            const key = randomUUID(); assert.equal((await learn(key)).currency,99);
            await rejects(learn(key),'DUPLICATE_REQUEST'); await rejects(learn(),'RECIPE_ALREADY_LEARNED');
            assert.equal((await repo.getCookingCatalog(users[0])).recipes.find(r=>r.id===recipeId).learned,true);
            assert.equal((await get()).currency,99);
        });
        await scenario('success consumes all materials and one AP, produces three', async () => {
            await learn(); const r = await cook();
            assert.equal(r.succeeded,true); assert.equal(r.ap,9); assert.equal(r.output.quantity,3);
            assert.deepEqual(r.consumed.map(x=>x.quantity),[3,1]); assert.equal(r.output.inventoryQuantity,13);
        });
        await scenario('failure floors each ingredient including quantity one, produces one', async () => {
            await learn(); await pool.query('update public.recipe set success_rate=0 where id=$1',[recipeId]);
            const r = await cook(); assert.equal(r.succeeded,false); assert.deepEqual(r.consumed.map(x=>x.quantity),[1,1]);
            assert.equal(r.output.itemId,items[3]); assert.equal(r.output.quantity,1); assert.equal(r.ap,9);
        });
        await scenario('cooking probability boundary uses injected RNG', async () => {
            await learn(); await pool.query('update public.recipe set success_rate=25 where id=$1',[recipeId]);
            assert.equal((await cook()).succeeded,false);
            assert.equal((await createCookingRepository(pool,{random:()=>0.249}).cookRecipe(users[0],recipeId,randomUUID())).succeeded,true);
        });
        await scenario('unlearned, currency/material/AP shortage and recipe configuration reject without effects', async () => {
            await rejects(cook(),'RECIPE_NOT_LEARNED');
            await pool.query('update public.game_character set currency=0 where id=$1',[characters[0]]); await rejects(learn(),'NOT_ENOUGH_CURRENCY');
            await pool.query('update public.game_character set currency=100 where id=$1',[characters[0]]); await learn();
            await pool.query('update public.inventory set quantity=2 where character_id=$1 and item_id=$2',[characters[0],items[0]]);
            const before = await snapshot(); await rejects(cook(),'NOT_ENOUGH_INGREDIENTS'); assert.deepEqual(await snapshot(),before);
            await pool.query('update public.game_character set ap=0 where id=$1',[characters[0]]); await rejects(cook(),'NOT_ENOUGH_AP');
            await pool.query('update public.game_character set ap=10 where id=$1',[characters[0]]);
            await pool.query('update public.recipe set result_quantity=3,success_rate=50,failure_item_id=null where id=$1',[recipeId]); await rejects(cook(),'RECIPE_CONFIG_INVALID');
        });
        await scenario('blood clamps, fixed ATK growth clamps and never changes another stat at cap', async () => {
            await pool.query('update public.game_character set blood=90,atk=39 where id=$1',[characters[0]]);
            let r = await eat(); assert.equal(r.blood,100); assert.equal(r.growth.amount,1); assert.equal(r.stats.atk,40);
            r = await eat(); assert.equal(r.growth,null); assert.equal(r.stats.def,5); assert.equal(r.dailyMealCount,2); assert.equal(r.inventoryQuantity,8);
        });
        await scenario('zero/disabled growth, fixed DEF, all capped still consume food and meal count', async () => {
            await pool.query('update public.food_config set stat_growth_rate=0 where item_id=$1',[items[2]]); assert.equal((await eat()).growth,null);
            await pool.query("update public.food_config set stat_growth_rate=100,stat_growth_target='DEF' where item_id=$1",[items[2]]);
            const r = await eat(); assert.equal(r.stats.def,8); assert.equal(r.stats.atk,5);
            await pool.query('update public.game_character set atk=40,def=40,agi=40 where id=$1',[characters[0]]);
            const all = await eat(); assert.equal(all.growth,null); assert.equal(all.dailyMealCount,3);
            assert.equal((await eat(randomUUID(),0,items[3])).growth,null);
        });
        await scenario('growth probability boundary and fixed AGI', async () => {
            await pool.query("update public.food_config set stat_growth_rate=25,stat_growth_target='AGI' where item_id=$1",[items[2]]);
            assert.equal((await eat()).growth,null);
            assert.equal((await createCookingRepository(pool,{random:()=>0.24}).eatFood(users[0],items[2],randomUUID())).growth.stat,'AGI');
        });
        await scenario('concurrent last daily meal succeeds once', async () => {
            await pool.query('update public.game_character set daily_meal_count=4 where id=$1',[characters[0]]);
            const r = await Promise.allSettled([eat(),eat()]); assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
            assert.equal(r.find(x=>x.status==='rejected').reason.code,'DAILY_MEAL_LIMIT'); assert.equal((await get()).daily_meal_count,5);
        });
        await scenario('concurrent learning and last AP serialize', async () => {
            assert.equal((await Promise.allSettled([learn(),learn()])).filter(r=>r.status==='fulfilled').length,1);
            await pool.query('update public.game_character set ap=1 where id=$1',[characters[0]]);
            assert.equal((await Promise.allSettled([cook(),cook()])).filter(r=>r.status==='fulfilled').length,1);
        });
        await scenario('duplicate UUID and cross-character key race never mutate twice', async () => {
            const key = randomUUID(); assert.equal((await Promise.allSettled([eat(key),eat(key)])).filter(r=>r.status==='fulfilled').length,1);
            await rejects(learn(key),'DUPLICATE_REQUEST'); await learn();
            const key2 = randomUUID(); await cook(key2); await rejects(cook(key2),'DUPLICATE_REQUEST');
            const key3 = randomUUID(); assert.equal((await Promise.allSettled([eat(key3,0),eat(key3,1)])).filter(r=>r.status==='fulfilled').length,1);
        });
        await scenario('DEAD/NEAR_DEATH all actions; absent food rejected', async () => {
            for (const [status,code] of [['DEAD','CHARACTER_DEAD'],['NEAR_DEATH','CHARACTER_NEAR_DEATH']]) {
                await pool.query('update public.game_character set status=$1 where id=$2',[status,characters[0]]);
                await rejects(learn(),code); await rejects(cook(),code);
                if(status==='DEAD')await rejects(eat(),code);else assert.equal((await eat()).dailyMealCount,1);
            }
            await pool.query("update public.game_character set status='ALIVE' where id=$1",[characters[0]]);
            await pool.query('update public.inventory set quantity=0 where character_id=$1 and item_id=$2',[characters[0],items[2]]); await rejects(eat(),'NOT_ENOUGH_FOOD');
            await rejects(eat(randomUUID(),0,items[0]),'FOOD_NOT_FOUND');
        });
        await scenario('log failure rolls back learn, cook and eat entirely', async () => {
            const faulty = createCookingRepository({query:(q,p)=>pool.query(q,p),async connect() {
                const c = await pool.connect(); return {release:()=>c.release(), query(sql,args) {
                    if (sql.includes('insert into public.action_log')) throw new Error('injected log failure');
                    return c.query(sql,args);
                }};
            }});
            let before = await snapshot(); await assert.rejects(faulty.learnRecipe(users[0],recipeId,randomUUID()),/injected/); assert.deepEqual(await snapshot(),before);
            await learn(); before = await snapshot(); await assert.rejects(faulty.cookRecipe(users[0],recipeId,randomUUID()),/injected/); assert.deepEqual(await snapshot(),before);
            await assert.rejects(faulty.eatFood(users[0],items[2],randomUUID()),/injected/); assert.deepEqual(await snapshot(),before);
        });
        await scenario('transaction-isolated settings: cost/cap changes and missing/invalid values', async () => {
            const c = await pool.connect(); await c.query('begin');
            const isolated = createCookingRepository({query:(q,p)=>c.query(q,p),async connect() { return {release(){}, async query(sql,args) {
                if (sql==='begin') return c.query('savepoint cooking_action');
                if (sql==='commit') return c.query('release savepoint cooking_action');
                if (sql==='rollback') return c.query('rollback to savepoint cooking_action');
                return c.query(sql,args);
            }}; }});
            try {
                await isolated.learnRecipe(users[0],recipeId,randomUUID());
                await c.query("update public.system_config set config_value='3'::jsonb where config_key='cooking_ap_cost'");
                assert.equal((await isolated.cookRecipe(users[0],recipeId,randomUUID())).ap,7);
                await c.query('update public.game_character set ap=2 where id=$1',[characters[0]]); await rejects(isolated.cookRecipe(users[0],recipeId,randomUUID()),'NOT_ENOUGH_AP');
                await c.query("update public.system_config set config_value='6'::jsonb where config_key='permanent_stat_cap'");
                assert.equal((await isolated.eatFood(users[0],items[2],randomUUID())).stats.atk,6);
                await c.query("delete from public.system_config where config_key='permanent_stat_cap'"); await rejects(isolated.eatFood(users[0],items[2],randomUUID()),'SYSTEM_CONFIG_MISSING');
                await c.query('update public.game_character set ap=10 where id=$1',[characters[0]]);
                await c.query(`update public.system_config set config_value='"bad"'::jsonb where config_key='cooking_ap_cost'`);
                await rejects(isolated.cookRecipe(users[0],recipeId,randomUUID()),'SYSTEM_CONFIG_INVALID');
            } finally { await c.query('rollback'); c.release(); }
        });
    } finally {
        const c = await pool.connect();
        try {
            await c.query('begin'); await c.query('delete from public.action_log where character_id=any($1::bigint[])',[characters]);
            await c.query('delete from public.character_recipe where character_id=any($1::bigint[])',[characters]);
            await c.query('delete from public.shop_purchase where character_id=any($1::bigint[])',[characters]);
            await c.query('delete from public.shop_product where recipe_id=$1',[recipeId]);
            await c.query('delete from public.recipe_discovery where recipe_id=$1',[recipeId]);
            await c.query('delete from public.recipe_ingredient where recipe_id=$1',[recipeId]); await c.query('delete from public.recipe where id=$1',[recipeId]);
            await c.query('delete from public.inventory where character_id=any($1::bigint[])',[characters]); await c.query('delete from public.food_config where item_id=any($1::bigint[])',[items]);
            await c.query('delete from public.item where id=any($1::bigint[])',[items]); await c.query('delete from public.auth_user where id=any($1::bigint[])',[users]);
            await c.query('delete from public.game_character where id=any($1::bigint[])',[characters]); await c.query('commit');
        } catch (e) { await c.query('rollback'); throw e; }
        finally { c.release(); await pool.end(); }
    }
});
