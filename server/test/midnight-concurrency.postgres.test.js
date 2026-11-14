import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool} from './isolated-pool.js';
import {beginGameTransaction, commitGameTransaction, rollbackGameTransaction} from '../src/shared/daily-gate.js';
import {actionTransaction} from '../src/shared/actions.js';
import {writeActionLog} from '../src/shared/game.js';
import {createDailyRecovery} from '../src/modules/daily/recovery.js';
import {createTrainingRepository} from '../src/modules/training/repository.js';
import {createBattleRepository} from '../src/modules/battle/repository.js';
import {createShopRepository} from '../src/modules/shop/repository.js';
import {createCookingRepository} from '../src/modules/cooking/repository.js';
import {createInvestigationRepository} from '../src/modules/investigation/repository.js';
import {transferInventoryItem} from '../src/modules/inventory/transfer.js';
import {createCharacterCareRepository} from '../src/modules/character/care-repository.js';
import {createCharacterCareService} from '../src/modules/character/care-service.js';

test('isolated PostgreSQL midnight ordering', {skip: !process.env.ISOLATED_PG_CONFIG}, async t => {
    const raw = createIsolatedPool(), schema = 'midnight_' + randomUUID().replaceAll('-', '');
    let instant = '2026-11-08T14:59:59.000Z';
    const rewrite = q => q.replaceAll('public.', schema + '.').replaceAll('clock_timestamp()', `'${instant}'::timestamptz`);
    const pool = {query: (q, p) => raw.query(rewrite(q), p), async connect() {const c = await raw.connect(); return {query: (q, p) => c.query(rewrite(q), p), release: () => c.release()};} };
    const recover = createDailyRecovery(pool);
    const row = async () => (await pool.query('select * from public.game_character order by id limit 1')).rows[0];
    const setup = async () => {
        instant = '2026-11-08T14:59:59.000Z';
        await pool.query('truncate public.action_log,public.game_character,public.auth_user,public.daily_reset_run,public.battle,public.battle_log cascade');
        await pool.query("update public.daily_reset_state set start_date='2026-11-01',last_completed_date='2026-11-08'");
        const c = (await pool.query(`insert into public.game_character(name,hunter_grade,atk,def,agi,hp,blood,ap,currency,daily_meal_count,daily_training_done,created_at)
            values('isolated','B',12,12,12,70,35,2,5,3,true,'2026-11-01T00:00:00Z') returning *`)).rows[0];
        const u = (await pool.query("insert into public.auth_user(role,mastodon_instance,mastodon_account_id,character_id) values('USER','isolated.invalid',$1,$2) returning id", [randomUUID(), c.id])).rows[0];
        return {...c, userId: u.id};
    };
    try {
        await raw.query(`create schema ${schema}`);
        const tables = (await raw.query("select tablename from pg_tables where schemaname='public'")).rows.map(r => r.tablename);
        for (const table of tables)
            await raw.query(`create table ${schema}.${table}(like public.${table} including all)`);
        const constraints = (await raw.query("select conrelid::regclass::text tbl,conname,pg_get_constraintdef(oid) def from pg_constraint where contype='f' and connamespace='public'::regnamespace")).rows;
        const ddl = await raw.connect();
        try {
            await ddl.query('begin'); await ddl.query(`set local search_path to ${schema},public`);
            for (const r of constraints) await ddl.query(`alter table ${schema}.${r.tbl.replace('public.', '')} add constraint ${r.conname} ${r.def.replaceAll('public.', schema + '.')}`);
            await ddl.query('commit');
        } finally {ddl.release();}
        // Copy only configuration, never accounts or operational gameplay records.
        await raw.query(`insert into ${schema}.system_config select * from public.system_config on conflict do nothing`);
        await pool.query('insert into public.daily_reset_state(singleton) values(true)');
        await t.test('pre-midnight action crossing boundary rolls back resources and log', async () => {
            const c = await setup(), client = await pool.connect();
            try {
                await beginGameTransaction(client);
                await client.query('update public.game_character set ap=ap-1 where id=$1', [c.id]);
                await writeActionLog(client, {characterId: c.id, category: 'CHARACTER', actionType: 'TEST', description: 'isolated', requestKey: randomUUID()});
                instant = '2026-11-08T15:00:00.000Z';
                await assert.rejects(commitGameTransaction(client), {code: 'GAME_DAY_CHANGED'});
                await rollbackGameTransaction(client);
                assert.equal((await row()).ap, 2); assert.equal((await pool.query('select * from public.action_log')).rowCount, 0);
                await recover(); assert.equal((await row()).ap, 10); assert.equal((await row()).blood, 25);
            } finally {client.release();}
        });
        await t.test('post-boundary action cannot run before reset; three resets apply once, 20 repetitions', async () => {
            for (let i = 0; i < 20; i++) {
                await setup(); instant = '2026-11-08T15:00:00.000Z';
                let ran = false;
                await assert.rejects(actionTransaction(pool, async () => {ran = true;}), {code: 'DAILY_RESET_REQUIRED'});
                assert.equal(ran, false);
                const results = await Promise.all([recover(), recover(), recover()]);
                assert.equal(results.filter(r => r.completed.length).length, 1);
                assert.equal((await row()).blood, 25);
                await actionTransaction(pool, c => c.query('update public.game_character set ap=ap-1'));
                assert.equal((await row()).ap, 9);
            }
        });
        await t.test('commit acknowledgement after midnight orders before reset when final check preceded midnight', async () => {
            const c = await setup(); let committing, release;
            const entered = new Promise(r => committing = r), wait = new Promise(r => release = r);
            const held = {                
async connect() {                    
const client = await pool.connect(); return {                        
release: () => client.release(), async query(q, p) {
                            if (q === 'commit') {committing(); await wait;} return client.query(q, p);
                        }                    
};                
}            
};
            const action = actionTransaction(held, async client => {
                await client.query('update public.game_character set ap=ap-1 where id=$1', [c.id]);
                await writeActionLog(client, {characterId: c.id, category: 'CHARACTER', actionType: 'TEST', description: 'before midnight', requestKey: randomUUID()});
            });
            await entered; instant = '2026-11-08T15:00:00.000Z'; let completed = false;
            const reset = recover().then(r => {completed = true; return r;});
            await new Promise(r => setTimeout(r, 50)); assert.equal(completed, false);
            release(); await action; await reset;
            assert.equal((await row()).ap, 10); assert.equal((await row()).blood, 25);
            const log = (await pool.query("select detail from public.action_log where action_type='TEST'")).rows[0];
            assert.equal(log.detail.dailyTransactionDay, '2026-11-08');
        });
        await t.test('shared action locks coexist; reset waits until both release', async () => {
            await setup(); const a = await pool.connect(), b = await pool.connect();
            try {
                await beginGameTransaction(a); await beginGameTransaction(b);
                instant = '2026-11-08T15:00:00.000Z'; let finished = false;
                const pending = recover().then(r => {finished = true; return r;});
                await new Promise(r => setTimeout(r, 100)); assert.equal(finished, false);
                await rollbackGameTransaction(a); await new Promise(r => setTimeout(r, 50)); assert.equal(finished, false);
                await rollbackGameTransaction(b); await pending; assert.equal((await row()).blood, 25);
            } finally {a.release(); b.release();}
        });
        await t.test('revival before boundary permits daily decay, uncertain multi-day history does not', async () => {
            const c = await setup(); await pool.query('update public.game_character set death_count=1,revive_count=1');
            await pool.query(`insert into public.action_log(character_id,category,action_type,target_type,target_id,description,created_at,detail)
                values($1,'CHARACTER','REVIVE','CHARACTER',$1,'test','2026-11-08T10:00:00Z',$2)`, [c.id, JSON.stringify({dailyTransactionDay: '2026-11-08', after: {target: {status: 'ALIVE', death_count: 1, revive_count: 1}}})]);
            instant = '2026-11-09T01:00:00.000Z'; await recover(); assert.equal((await row()).blood, 25);
            await setup(); await pool.query("update public.daily_reset_state set last_completed_date='2026-11-06'");
            await pool.query('update public.game_character set death_count=1,revive_count=1');
            instant = '2026-11-08T15:00:00.000Z'; const result = await recover();
            assert.equal(result.completed.length, 3); assert.equal((await row()).blood, 35);
        });
        await t.test('legacy preflight-only pattern reproduces stale AP action after midnight', async () => {
            const c = await setup(); await recover(); // The old app-only check returns before midnight.
            instant = '2026-11-08T15:00:00.000Z';
            const client = await pool.connect();
            try {
                await client.query('begin');
                await client.query('update public.game_character set ap=ap-1 where id=$1', [c.id]);
                await writeActionLog(client, {characterId: c.id, category: 'CHARACTER', actionType: 'LEGACY', description: 'reproduction'});
                await client.query('commit');
                assert.equal((await row()).ap, 1); // Wrong day resources, not the expected reset AP 9.
                await assert.rejects(recover(), {code: 'DAILY_RESET_ACTIVITY_HOLD'});
            } finally {client.release();}
        });
        await t.test('untrusted legacy revival timestamps do not establish historical eligibility', async () => {
            const c = await setup(); await pool.query('update public.game_character set death_count=1,revive_count=1');
            await pool.query(`insert into public.action_log(character_id,category,action_type,target_type,target_id,description,created_at,detail)
                values($1,'CHARACTER','REVIVE','CHARACTER',$1,'legacy','2026-11-08T10:00:00Z',$2)`, [c.id, JSON.stringify({after: {target: {status: 'ALIVE', death_count: 1, revive_count: 1}}})]);
            instant = '2026-11-08T15:00:00.000Z'; await recover(); assert.equal((await row()).blood, 35);
        });
        await t.test('real revive transaction produces next-day lifecycle evidence', async () => {
            const c = await setup();
            const target = (await pool.query(`insert into public.game_character(name,hunter_grade,atk,def,agi,hp,blood,status,death_count,created_at)
                values('revived','B',12,12,12,0,0,'DEAD',1,'2026-11-01T00:00:00Z') returning id`)).rows[0];
            const care = createCharacterCareService(createCharacterCareRepository(pool));
            await care.revive(c.userId, String(target.id), {requestKey: randomUUID()});
            instant = '2026-11-08T15:00:00.000Z'; await recover();
            const after = (await pool.query('select * from public.game_character where id=$1', [target.id])).rows[0];
            assert.equal(after.blood, 40); assert.equal(after.status, 'ALIVE'); assert.equal(after.revive_count, 1);
        });
        await t.test('start HOLD and existing activity HOLD are preserved', async () => {
            await setup(); await pool.query('update public.daily_reset_state set start_date=null,last_completed_date=null');
            assert.equal((await recover()).hold, 'DAILY_RESET_START_HOLD'); assert.equal((await row()).ap, 2);
            const c = await setup(); instant = '2026-11-08T15:00:00.000Z';
            await pool.query("insert into public.action_log(character_id,category,action_type,description,created_at) values($1,'CHARACTER','LEGACY','test',clock_timestamp())", [c.id]);
            await assert.rejects(recover(), {code: 'DAILY_RESET_ACTIVITY_HOLD'}); assert.equal((await row()).ap, 2);
        });
        await t.test('actual training requests serialize; lost response retry cannot pay twice', async () => {
            const c = await setup(); await pool.query('update public.game_character set daily_training_done=false');
            const training = createTrainingRepository(pool, {random: () => 0.9}), key = randomUUID();
            const results = await Promise.allSettled([training.trainCharacter(c.userId, key), training.trainCharacter(c.userId, key)]);
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(results.find(r => r.status === 'rejected').reason.code, 'DUPLICATE_REQUEST');
            await assert.rejects(training.trainCharacter(c.userId, key), {code: 'DUPLICATE_REQUEST'});
            assert.equal((await row()).currency, 6);
        });
        await t.test('investigation/shop/cooking/training/transfer share post-reset resources, 10 repetitions', async () => {
            for (let n = 0; n < 10; n++) {
                const c = await setup(); instant = '2026-11-08T15:00:00.000Z'; await recover();
                const target = (await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi) values('recipient','B',12,12,12) returning id")).rows[0];
                const ingredient = (await pool.query("insert into public.item(name,category,transferable) values('ingredient','MATERIAL',true) returning id")).rows[0];
                const food = (await pool.query("insert into public.item(name,category) values('food','FOOD') returning id")).rows[0];
                const failure = (await pool.query("insert into public.item(name,category) values('failure','FOOD') returning id")).rows[0];
                await pool.query('insert into public.inventory(character_id,item_id,quantity) values($1,$2,10)', [c.id, ingredient.id]);
                const recipe = (await pool.query("insert into public.recipe(name,result_item_id,failure_item_id,success_rate,result_quantity) values('recipe',$1,$2,80,3) returning id", [food.id, failure.id])).rows[0];
                await pool.query('insert into public.recipe_ingredient(recipe_id,item_id,quantity) values($1,$2,2)', [recipe.id, ingredient.id]);
                await pool.query('insert into public.character_recipe(character_id,recipe_id) values($1,$2)', [c.id, recipe.id]);
                const product = (await pool.query('insert into public.shop_product(item_id,price) values($1,1) returning id', [ingredient.id])).rows[0];
                const area = (await pool.query("insert into public.area(name,is_open,encounter_rate) values('area',true,0) returning id")).rows[0];
                await pool.query("insert into public.investigation_result(area_id,result_grade,result_text,weight) values($1,'NORMAL','test',1)", [area.id]);
                const results = await Promise.allSettled([
                    createInvestigationRepository(pool, {random: () => 0}).investigate(c.userId, area.id, randomUUID()),
                    createShopRepository(pool).buyProduct(c.userId, product.id, 1, randomUUID()),
                    createCookingRepository(pool, {random: () => 0}).cookRecipe(c.userId, recipe.id, randomUUID()),
                    createTrainingRepository(pool, {random: () => 0.9}).trainCharacter(c.userId, randomUUID()),
                    transferInventoryItem(pool, c.userId, target.id, ingredient.id, 1, randomUUID())
                ]);
                assert.deepEqual(results.filter(r => r.status === 'rejected').map(r => r.reason.code), []);
                const after = await row(); assert.equal(after.ap, 8); assert.equal(after.currency, 5); assert.equal(after.blood, 25);
                assert.equal((await pool.query('select quantity from public.inventory where character_id=$1 and item_id=$2', [c.id, ingredient.id])).rows[0].quantity, 8);
            }
        });
        await t.test('midnight defeat and expiry race never issue two endings or rewards', async () => {
            const c = await setup(); await pool.query('update public.game_character set blood=5');
            const monster = (await pool.query("insert into public.monster(name,max_hp,atk,def,agi) values('test',10,1,1,1) returning id")).rows[0];
            const area = (await pool.query("insert into public.area(name) values('expiry') returning id")).rows[0];
            const b = (await pool.query(`insert into public.battle(character_id,monster_id,area_id,character_hp,monster_hp,monster_max_hp,monster_atk,monster_def,monster_agi,battle_status,started_at)
                values($1,$2,$3,70,10,10,1,1,1,'ACTIVE','2026-11-06T00:00:00Z') returning id`, [c.id, monster.id, area.id])).rows[0];
            instant = '2026-11-08T15:00:00.000Z';
            const battles = createBattleRepository(pool);
            const results = await Promise.allSettled([recover(), recover(), battles.expireBattles()]);
            for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.code, 'DAILY_RESET_REQUIRED');
            await battles.expireBattles();
            const ended = (await pool.query('select * from public.battle where id=$1', [b.id])).rows[0];
            assert.equal(ended.battle_status, 'DEFEAT'); assert.equal(ended.end_reason, 'MIDNIGHT_NEAR_DEATH');
            assert.equal((await pool.query('select * from public.battle_log where battle_id=$1', [b.id])).rowCount, 1);
            assert.equal((await row()).currency, 5); assert.equal((await row()).hp, 70);
        });
        await t.test('lock wait is bounded and rollback releases the shared lock', async () => {
            const c = await setup(), blocker = await pool.connect();
            try {
                await blocker.query('begin'); await blocker.query('select * from public.game_character where id=$1 for update', [c.id]);
                await assert.rejects(actionTransaction(pool, client => client.query('update public.game_character set ap=0 where id=$1', [c.id])), {code: '55P03'});
                await blocker.query('rollback');
                instant = '2026-11-08T15:00:00.000Z'; await recover(); assert.equal((await row()).ap, 10);
            } finally {blocker.release();}
        });
        await t.test('injected inverted business locks roll back the deadlock victim without partial resources', async () => {
            const c = await setup();
            const other = (await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,currency) values('deadlock test','B',12,12,12,5) returning id")).rows[0];
            let ready = 0, release; const both = new Promise(r => release = r);
            const run = (first, second) => actionTransaction(pool, async client => {
                await client.query('update public.game_character set currency=currency+1 where id=$1', [first]);
                if (++ready === 2) release(); await both;
                await client.query('update public.game_character set currency=currency+1 where id=$1', [second]);
            });
            const results = await Promise.allSettled([run(c.id, other.id), run(other.id, c.id)]);
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(results.find(r => r.status === 'rejected').reason.code, '40P01');
            assert.deepEqual((await pool.query('select currency from public.game_character order by id')).rows.map(r => r.currency), [6, 6]);
            instant = '2026-11-08T15:00:00.000Z'; await recover(); assert.equal((await row()).ap, 10);
        });
    } finally {await raw.query(`drop schema if exists ${schema} cascade`); await raw.end();}
});
