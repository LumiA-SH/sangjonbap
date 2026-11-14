import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID as key} from 'node:crypto';
import {createIsolatedPool} from './isolated-pool.js';
import {createAdminCompletionRepository} from '../src/modules/admin/completion-repository.js';
import {createCookingRepository} from '../src/modules/cooking/repository.js';
import {createInventoryRepository} from '../src/modules/inventory/repository.js';
import {createRecordsRepository} from '../src/modules/records/repository.js';
import {createAdminRepository} from '../src/modules/admin/repository.js';
import {failureRpText} from '../src/modules/cooking/failure-rp.js';
test('failure RP uniform boundaries and legacy fallback', () => {
    assert.equal(failureRpText({rp_effect_text: 'legacy'}, () => 0), 'legacy');
    assert.equal(failureRpText({rp_effect_texts: ['a']}, () => {throw Error();}), 'a');
    for (const [unit, expected] of [[0, 'a'], [0.4999, 'a'], [0.5, 'b'], [0.9999, 'b']]) assert.equal(failureRpText({rp_effect_texts: ['a', 'b']}, () => unit), expected);
    assert.ok(failureRpText({}, () => 0));
});
test('P2 isolated PostgreSQL data, audit and contention', {skip: !process.env.ISOLATED_PG_CONFIG}, async t => {
    const raw = createIsolatedPool(), schema = 'p2_' + key().replaceAll('-', ''); let fault = false;
    const sql = q => q.replaceAll('public.', schema + '.'); const pool = {query: (q, p) => raw.query(sql(q), p), async connect() {const c = await raw.connect(); return {release: () => c.release(), query(q, p) {if (fault && q.includes('insert into public.action_log')) throw Error('audit fault'); return c.query(sql(q), p);} };} };
    const admin = createAdminCompletionRepository(pool);
    try {
        await t.test('additive migration preserves nonempty legacy rows; DDL rollback works', async () => {
            const c = await raw.connect(), s = schema + '_migration'; try {                
await c.query('begin'); await c.query('create schema ' + s); await c.query('create table ' + s + ".food_config(item_id bigint primary key,rp_effect_text text,blood_recovery integer);create table " + s + ".clue(id bigint primary key,is_discovered boolean,content text)"); await c.query('insert into ' + s + ".food_config values(1,'old',27);insert into " + s + ".clue values(1,true,'secret')");
                await c.query(fs.readFileSync(new URL('../../supabase/migrations/20261109170000_p1_admin_completion.sql', import.meta.url), 'utf8').replaceAll('public.', s + '.'));
                assert.deepEqual((await c.query('select * from ' + s + '.food_config')).rows, [{item_id: '1', rp_effect_text: 'old', blood_recovery: 27, rp_effect_texts: []}]); assert.deepEqual((await c.query('select * from ' + s + '.clue')).rows, [{id: '1', is_discovered: true, content: 'secret', is_public: true}]); await c.query('rollback'); assert.equal((await c.query('select to_regnamespace($1) n', [s])).rows[0].n, null);
            } finally {await c.query('rollback'); c.release();}
        });
        await raw.query('create schema ' + schema); for (const {tablename} of (await raw.query("select tablename from pg_tables where schemaname='public'")).rows) await raw.query('create table ' + schema + '.' + tablename + '(like public.' + tablename + ' including all)');
        await pool.query('insert into public.daily_reset_state(singleton) values(true)'); await raw.query('insert into ' + schema + '.system_config select * from public.system_config');
        const account = async role => {const c = (await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,hp,blood,ap,currency) values('test','B',20,20,20,80,80,7,10) returning *")).rows[0]; const u = (await pool.query("insert into public.auth_user(role,mastodon_instance,mastodon_account_id,character_id) values($1,'mock',$2,$3) returning *", [role, key(), c.id])).rows[0]; return {c, u};}; const owner = await account('ADMIN'), runner = await account('USER');
        const item = (await pool.query("insert into public.item(name,category,transferable) values('food','FOOD',true) returning id")).rows[0].id;
        await t.test('failed meals choose per use, preserve every resource/stat, count meals, persist selected RP', async () => {
            await pool.query("insert into public.food_config(item_id,blood_recovery,is_failure,rp_effect_text,rp_effect_texts) values($1,30,true,'legacy',ARRAY['first','second'])", [item]); await pool.query('insert into public.inventory(character_id,item_id,quantity) values($1,$2,10)', [runner.c.id, item]);
            for (const [random, expected] of [[0, 'first'], [0.9, 'second']]) {const req = key(), r = await createCookingRepository(pool, {random: () => random}).eatFood(runner.u.id, item, req); assert.equal(r.rpEffectText, expected); assert.equal(r.growth, null); assert.ok(JSON.stringify((await pool.query('select detail from public.action_log where request_key=$1', [req])).rows[0]).includes(expected));}
            const c = (await pool.query('select hp,blood,ap,atk,def,agi,daily_meal_count from public.game_character where id=$1', [runner.c.id])).rows[0]; assert.deepEqual(c, {hp: 80, blood: 80, ap: 7, atk: 20, def: 20, agi: 20, daily_meal_count: 2});
        });
        await t.test('admin RP candidates save, remove and audit while preserving legacy text', async () => {
            const master = createAdminRepository(pool); await master.saveAdminMaster(owner.u.id, 'foods', item, {rp_effect_texts: ['new']}, key()); assert.deepEqual((await master.getAdminMaster('foods', item)).rp_effect_texts, ['new']); await master.saveAdminMaster(owner.u.id, 'foods', item, {rp_effect_texts: []}, key()); assert.equal((await master.getAdminMaster('foods', item)).rp_effect_text, 'legacy'); assert.equal((await createCookingRepository(pool).eatFood(runner.u.id, item, key())).rpEffectText, 'legacy');
            await assert.rejects(master.saveAdminMaster(owner.u.id, 'foods', item, {rp_effect_texts: ['']}, key()), {code: 'INVALID_ADMIN_INPUT'}); assert.ok((await pool.query("select 1 from public.action_log where action_type='FOOD_CONFIG_UPDATE' and detail->'after'->'rp_effect_texts'='[]'::jsonb")).rowCount);
        });
        await t.test('stock role, integer, duplicate, optimistic race and audit rollback', async () => {
            const body = (quantity = 5, expectedQuantity = 0) => ({quantity, expectedQuantity, reason: 'test', requestKey: key()});
            await assert.rejects(admin.saveAdminStorage(runner.u.id, item, body()), {code: 'ADMIN_REQUIRED'});
            for (const n of [-1, 1.5, 2147483648]) assert.throws(() => admin.saveAdminStorage(owner.u.id, item, body(n)));
            const b = body(); await admin.saveAdminStorage(owner.u.id, item, b); await assert.rejects(admin.saveAdminStorage(owner.u.id, item, b), {code: 'DUPLICATE_REQUEST'});
            const store = createInventoryRepository(pool);
            for (let i = 0; i < 10; i++) {await pool.query('update public.storage set quantity=5 where item_id=$1', [item]); await pool.query('update public.inventory set quantity=10 where character_id=$1 and item_id=$2', [runner.c.id, item]); const result = await Promise.allSettled([admin.saveAdminStorage(owner.u.id, item, body(10, 5)), store.deposit(runner.u.id, item, 1, key())]); const n = (await pool.query('select quantity from public.storage where item_id=$1', [item])).rows[0].quantity; assert.equal(result[1].status, 'fulfilled'); if (result[0].status === 'fulfilled') assert.equal(n, 11); else {assert.equal(result[0].reason.code, 'ADMIN_EDIT_CONFLICT'); assert.equal(n, 6);} }
            const before = (await pool.query('select quantity from public.storage where item_id=$1', [item])).rows[0].quantity; fault = true; await assert.rejects(admin.saveAdminStorage(owner.u.id, item, body(0, before)), /audit fault/); fault = false; assert.equal((await pool.query('select quantity from public.storage where item_id=$1', [item])).rows[0].quantity, before);
            assert.ok((await pool.query("select 1 from public.action_log where action_type='STORAGE_ADJUST' and admin_user_id=$1 and detail->>'reason'='test'", [owner.u.id])).rowCount);
        });
        await t.test('clue edits preserve discovery and progress, visibility and stale conflicts', async () => {
            const area = (await pool.query("insert into public.area(name) values('area') returning id")).rows[0].id; const body = {title: 'clue', content: 'private content', area_id: area, related_target: 'target', is_public: true, reason: 'test', requestKey: key()};
            await assert.rejects(admin.saveAdminClue(runner.u.id, null, body), {code: 'ADMIN_REQUIRED'}); let saved = await admin.saveAdminClue(owner.u.id, null, body); const id = saved.record.id, records = createRecordsRepository(pool); assert.equal((await records.getClueRecords(runner.u.id)).length, 0);
            await pool.query('update public.clue set is_discovered=true,first_discoverer_id=$2,discovered_at=now() where id=$1', [id, runner.c.id]); saved = await admin.getAdminClue(id); const before = (await pool.query('select * from public.area where id=$1', [area])).rows[0]; assert.equal((await records.getClueRecords(runner.u.id)).length, 1);
            const updated = await admin.saveAdminClue(owner.u.id, id, {...body, title: 'edited', is_public: false, expectedVersion: saved.version, requestKey: key()}); assert.equal(updated.record.first_discoverer_id, runner.c.id); assert.equal(updated.record.is_discovered, true); assert.equal((await records.getClueRecords(runner.u.id)).length, 0); assert.deepEqual((await pool.query('select * from public.area where id=$1', [area])).rows[0], before);
            await assert.rejects(admin.saveAdminClue(owner.u.id, id, {...body, expectedVersion: saved.version, requestKey: key()}), {code: 'ADMIN_EDIT_CONFLICT'});
        });
        await t.test('character detail edits preserve life state, detect concurrent edits and roll back on audit failure', async () => {
            let saved = await admin.getAdminCharacterDetails(runner.c.id); const body = {hunter_grade: 'S', has_ability: true, ability_grade: 'B', recipe_ids: [], daily_meal_count: 3, daily_training_done: true, death_count: 0, revive_count: 0, reason: 'test', expectedVersion: saved.version, requestKey: key()};
            await assert.rejects(admin.saveAdminCharacterDetails(runner.u.id, runner.c.id, body), {code: 'ADMIN_REQUIRED'}); const done = await admin.saveAdminCharacterDetails(owner.u.id, runner.c.id, body); assert.equal(done.record.hp, 80); assert.equal(done.record.blood, 80); assert.equal(done.record.status, 'ALIVE'); assert.ok(done.record.last_training_date); assert.equal(done.record.hunter_grade, 'S');
            await assert.rejects(admin.saveAdminCharacterDetails(owner.u.id, runner.c.id, {...body, requestKey: key()}), {code: 'ADMIN_EDIT_CONFLICT'});
            assert.throws(() => admin.saveAdminCharacterDetails(owner.u.id, runner.c.id, {...body, revive_count: 2, death_count: 1, expectedVersion: done.version, requestKey: key()}));
            await assert.rejects(admin.saveAdminCharacterDetails(owner.u.id, runner.c.id, {...body, death_count: 1, expectedVersion: done.version, requestKey: key()}), {code: 'INVALID_ADMIN_INPUT'});
            fault = true; await assert.rejects(admin.saveAdminCharacterDetails(owner.u.id, runner.c.id, {...body, hunter_grade: 'A', expectedVersion: done.version, requestKey: key()}), /audit fault/); fault = false; assert.deepEqual(await admin.getAdminCharacterDetails(runner.c.id), done);
        });
        await t.test('recipe ownership edits preserve first-discovery ledger and block active battle', async () => {
            const recipe = (await pool.query("insert into public.recipe(name,result_item_id) values('known',$1) returning id", [item])).rows[0].id;
            const make = async () => {const r = await admin.getAdminCharacterDetails(runner.c.id); const {hp, blood, status, id, last_training_date, ...editable} = r.record; return {...editable, reason: 'test', expectedVersion: r.version, requestKey: key()};};
            await assert.rejects(admin.saveAdminCharacterDetails(owner.u.id, runner.c.id, {...await make(), recipe_ids: [recipe]}), {code: 'RECIPE_NOT_DISCOVERED'});
            await pool.query("insert into public.recipe_discovery(recipe_id,character_id,source_type,source_id) values($1,$2,'INVESTIGATION',1)", [recipe, runner.c.id]); const history = (await pool.query('select * from public.recipe_discovery')).rows;
            await admin.saveAdminCharacterDetails(owner.u.id, runner.c.id, {...await make(), recipe_ids: [recipe]}); assert.deepEqual((await admin.getAdminCharacterDetails(runner.c.id)).record.recipe_ids, [recipe]); await admin.saveAdminCharacterDetails(owner.u.id, runner.c.id, {...await make(), recipe_ids: []}); assert.deepEqual((await pool.query('select * from public.recipe_discovery')).rows, history);
            const area = (await pool.query("insert into public.area(name) values('arena') returning id")).rows[0].id, monster = (await pool.query("insert into public.monster(name,max_hp,atk,def,agi) values('enemy',100,1,1,1) returning id")).rows[0].id;
            await pool.query('insert into public.monster_drop(monster_id,recipe_id,drop_rate,min_quantity,max_quantity,is_ingredient) values($1,$2,25,1,1,false)', [monster, recipe]); const listed = (await createAdminRepository(pool).listAdminMonsters()).find(m => m.id === monster); assert.deepEqual(listed.recipe_drops, [{recipeId: recipe, name: 'known', dropRate: 25, discovered: true}]);
            await pool.query("insert into public.battle(character_id,monster_id,area_id,character_hp,monster_hp,monster_max_hp,monster_atk,monster_def,monster_agi,battle_status) values($1,$2,$3,80,100,100,1,1,1,'ACTIVE')", [runner.c.id, monster, area]); await assert.rejects(admin.saveAdminCharacterDetails(owner.u.id, runner.c.id, await make()), {code: 'BATTLE_ACTIVE'});
        });
    } finally {fault = false; await raw.query('drop schema if exists ' + schema + ' cascade'); await raw.end();}
});
