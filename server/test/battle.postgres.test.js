import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createIsolatedPool as createPool} from './isolated-pool.js';
import {createDailyRecovery} from '../src/modules/daily/recovery.js';
import {createBattleRepository} from '../src/modules/battle/repository.js';
import {createAdminRepository} from '../src/modules/admin/repository.js';
import {createInvestigationRepository} from '../src/modules/investigation/repository.js';
import {createCharacterCareService} from '../src/modules/character/care-service.js';
import {createCharacterCareRepository} from '../src/modules/character/care-repository.js';
import {createCookingRepository} from '../src/modules/cooking/repository.js';
import {createShopRepository} from '../src/modules/shop/repository.js';
import {createInventoryRepository} from '../src/modules/inventory/repository.js';
import {createBloodPackRepository} from '../src/modules/inventory/blood-pack.js';
import {createGachaRepository} from '../src/modules/gacha/repository.js';
import {createTrainingRepository} from '../src/modules/training/repository.js';

const rejects = (p, code) => assert.rejects(p, e => e.code === code);
test('PVE PostgreSQL transactions, snapshots, registration and concurrency', {skip: process.env.RUN_BATTLE_DB_TESTS !== '1'}, async t => {
    const raw = createPool(), schema = `test_pve_${randomUUID().replaceAll('-', '')}`;
    const tables = ['food_grade', 'auth_user', 'game_character', 'food_config', 'item', 'inventory', 'action_log', 'system_config', 'battle', 'battle_log', 'area',
        'daily_reset_state', 'daily_reset_run', 'monster', 'monster_action', 'monster_drop', 'area_monster', 'investigation_result', 'investigation_reward', 'unique_discovery', 'clue',
        'recipe', 'character_recipe', 'shop_product', 'shop_purchase', 'blood_pack_purchase_day', 'storage', 'gacha', 'gacha_reward'];
    const migrated = (await raw.query("select to_regclass('public.recipe_discovery') is not null as ready")).rows[0].ready;
    if (migrated) tables.push('recipe_discovery');
    const sql = q => q.replaceAll('public.', `${schema}.`);
    let failLog = false;
    const pool = {        
query: (q, p) => raw.query(sql(q), p), async connect() {            
const c = await raw.connect(); return {
                release: () => c.release(), query: (q, p) => {if (failLog && q.includes('insert into public.action_log')) throw Error('injected log failure'); return c.query(sql(q), p);}
            };        
}    
};
    await raw.query(`create schema ${schema}`);
    try {
        for (const table of tables) await raw.query(`create table ${schema}.${table} (like public.${table} including all)`);
        await pool.query('insert into public.daily_reset_state(singleton) values(true) on conflict do nothing');
        // LIKE copies checks/indexes, not foreign keys. Restore all in-scope references.
        const constraints = (await raw.query(`select conrelid::regclass::text tbl,confrelid::regclass::text ref,
            conname,pg_get_constraintdef(oid) def from pg_constraint where contype='f' and connamespace='public'::regnamespace`)).rows;
        const ddl = await raw.connect();
        try {
            await ddl.query('begin'); await ddl.query(`set local search_path to ${schema},public`);
            for (const row of constraints) {
                const table = row.tbl.replace('public.', ''), ref = row.ref.replace('public.', '');
                if (tables.includes(table) && tables.includes(ref)) await ddl.query(`alter table ${schema}.${table} add constraint ${row.conname} ${row.def.replaceAll('public.', `${schema}.`)}`);
            }
            await ddl.query('commit');
        } catch (e) {await ddl.query('rollback'); throw e;} finally {ddl.release();}
        await raw.query(`insert into ${schema}.system_config select * from public.system_config`);
        const account = async (role = 'USER') => (await pool.query(`insert into public.auth_user(role,mastodon_instance,mastodon_account_id,oauth_verified_at)
            values($1,'https://example.invalid',$2,now()) returning *`, [role, randomUUID()])).rows[0];
        // Execute the new migration only through the isolated-schema SQL rewriter.
        await pool.query(readFileSync(new URL('../../supabase/migrations/20261101032815_common_rules_v02.sql', import.meta.url), 'utf8'));
        if (!migrated) await pool.query(readFileSync(new URL('../../supabase/migrations/20261101091456_recipe_first_discovery.sql', import.meta.url), 'utf8'));
        const configured = Object.fromEntries((await pool.query("select config_key,config_value from public.system_config where config_key in ('revive_blood','training_great_rate_a','training_great_rate_s')")).rows.map(r => [r.config_key, r.config_value]));
        assert.deepEqual(configured, {revive_blood: 50, training_great_rate_a: 20, training_great_rate_s: 15});
        const admin = await account('ADMIN'), user = await account(), other = await account();
        const repo = createBattleRepository(pool, {random: () => 0}), masters = createAdminRepository(pool);
        const input = {name: 'DEV isolated PVE', hunter_grade: 'B', atk: 16, def: 10, agi: 10, has_ability: true, ability_grade: 'B', instance: user.mastodon_instance, accountId: user.mastodon_account_id};
        let character;
        await t.test('admin registration verified identity, unauthorized, concurrent duplicate and initial stats', async () => {
            await rejects(masters.registerAdminCharacter(other.id, user.id, {...input, requestKey: randomUUID()}), 'ADMIN_REQUIRED');
            await rejects(masters.registerAdminCharacter(admin.id, user.id, {...input, accountId: 'wrong', requestKey: randomUUID()}), 'VERIFIED_ACCOUNT_REQUIRED');
            const results = await Promise.allSettled([1, 2].map(() => masters.registerAdminCharacter(admin.id, user.id, {...input, requestKey: randomUUID()})));
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); character = results.find(r => r.status === 'fulfilled').value;
            assert.equal(character.blood, 100); assert.equal(character.max_blood, 100); assert.equal(character.atk, 16);
            await rejects(repo.getBattle(other.id), 'CHARACTER_NOT_FOUND');
        });
        const area = (await pool.query("insert into public.area(name,is_open,encounter_rate) values('DEV PVE area',true,100) returning *")).rows[0];
        await pool.query(`insert into public.investigation_result(area_id,result_grade,result_text,weight,is_unique,investigation_rate_value)
            values($1,'NORMAL','DEV result',1,false,0)`, [area.id]);
        const item = (await pool.query("insert into public.item(name,category) values('DEV drop','MATERIAL') returning *")).rows[0];
        const pack = (await pool.query(`insert into public.item(name,category,usable,use_target,effect_type,effect_value,battle_usable)
            values('DEV pack','CONSUMABLE',true,'SELF','BLOOD_PACK',30,true) returning *`)).rows[0];
        const monsterBody = {            
name: 'DEV isolated monster', description: null, image_url: null, max_hp: 100, atk: 20, def: 10, agi: 10, is_active: true,
            actions: [{name: 'attack', action_type: 'ATTACK', probability: 100, multiplier: 1, is_active: true, sort_order: 0}],
            areas: [{area_id: area.id, weight: 1}], drops: [{item_id: item.id, drop_rate: 100, min_quantity: 2, max_quantity: 2, is_ingredient: true}]        
};
        let monster = await masters.saveAdminMonster(admin.id, null, {...monsterBody, requestKey: randomUUID()});
        const investigation = createInvestigationRepository(pool, {random: () => 0, battleRepository: repo});
        const start = async () => {
            await pool.query("update public.battle set battle_status='DEFEAT' where character_id=$1 and battle_status='ACTIVE'", [character.id]);
            await pool.query("update public.game_character set hp=100,blood=100,ap=10,status='ALIVE' where id=$1", [character.id]);
            return (await investigation.investigate(user.id, area.id, randomUUID())).battle;
        };
        const command = (battle, options = {}) => repo.commandBattle(user.id, battle.id, {requestKey: randomUUID(), turnNo: battle.turn_no, action: 'ATTACK', ...options});
        const current = async () => (await pool.query('select * from public.game_character where id=$1', [character.id])).rows[0];
        await t.test('investigation creates one active battle, reconnect is read-only, ownership enforced', async () => {
            const b = await start(); assert.equal(b.battle_status, 'ACTIVE');
            const read = await repo.getBattle(user.id, b.id); assert.deepEqual(read.battle, b); assert.equal(read.battle.last_command_at, null);
            await rejects(investigation.investigate(user.id, area.id, randomUUID()), 'BATTLE_ACTIVE');
            await rejects(repo.getBattle(other.id, b.id), 'CHARACTER_NOT_FOUND');
            await rejects(createCookingRepository(pool).eatFood(user.id, item.id, randomUUID()), 'BATTLE_ACTIVE');
        });
        await t.test('same UUID and different UUID concurrent turn consumes resources once', async () => {
            let b = await start(), key = randomUUID();
            let r = await Promise.allSettled([command(b, {requestKey: key}), command(b, {requestKey: key})]);
            assert.equal(r.filter(x => x.status === 'fulfilled').length, 1); assert.equal((await current()).blood, 100);
            b = await start(); r = await Promise.allSettled([command(b), command(b)]);
            assert.equal(r.filter(x => x.status === 'fulfilled').length, 1); assert.equal((await current()).blood, 100);
        });
        await t.test('admin changes do not change active monster/actions/drops snapshots', async () => {
            const b = await start();
            await masters.saveAdminMonster(admin.id, monster.id, {...monsterBody, atk: 100, actions: [{...monsterBody.actions[0], action_type: 'FLEE'}], drops: [{...monsterBody.drops[0], min_quantity: 3, max_quantity: 3}], requestKey: randomUUID()});
            const r = await command(b); assert.equal(r.resolved.enemyDamage, 11); assert.equal(r.battle.declaration.action_type, 'ATTACK');
            monster = await masters.saveAdminMonster(admin.id, monster.id, {...monsterBody, requestKey: randomUUID()});
        });
        await t.test('ability settings affect new battles, existing snapshot stays; admin failure rolls back', async () => {
            const b = await start(), settings = await masters.getAdminAbilitySettings();
            const changed = {...settings, battle_ability_b_multiplier: 3, battle_ability_b_ap_cost: 4};
            await masters.saveAdminAbilitySettings(admin.id, {settings: changed, requestKey: randomUUID()});
            const old = await command(b, {action: 'ABILITY'}); assert.equal(old.character.ap, 7); // Investigation AP1 + original ability AP2.
            const fresh = await start(), r = await command(fresh, {action: 'ABILITY'});
            assert.equal(r.character.ap, 5); assert.equal(r.resolved.pcDamage, 48);
            failLog = true;
            try {await assert.rejects(masters.saveAdminMonster(admin.id, monster.id, {...monsterBody, atk: 999, requestKey: randomUUID()}), /injected/);} finally {failLog = false;}
            assert.equal((await masters.getAdminMonster(monster.id)).atk, 20);
            await masters.saveAdminAbilitySettings(admin.id, {settings, requestKey: randomUUID()});
            const updated = await masters.saveAdminRecord(admin.id, 'items', pack.id, {effect_value: 45, battle_usable: true}, randomUUID());
            assert.equal(updated.effect_value, 45);
            await masters.saveAdminRecord(admin.id, 'items', pack.id, {effect_value: 30}, randomUUID());
        });
        await t.test('simultaneous death victory applies death once and rewards once', async () => {
            const b = await start(); await pool.query('update public.game_character set hp=1 where id=$1', [character.id]);
            await pool.query('update public.battle set monster_hp=1 where id=$1', [b.id]);
            const count = (await current()).death_count, key = randomUUID();
            const concurrent = await Promise.allSettled([command(b, {requestKey: key}), command(b)]);
            assert.equal(concurrent.filter(x => x.status === 'fulfilled').length, 1);
            const r = concurrent.find(x => x.status === 'fulfilled').value; assert.equal(r.battle.battle_status, 'VICTORY'); assert.equal(r.character.status, 'DEAD');
            assert.equal(r.character.death_count, count + 1); assert.equal(r.rewards[0].quantity, 2);
            const committed = (await pool.query("select request_key from public.action_log where target_id=$1 and action_type='BATTLE_COMMAND'", [b.id])).rows[0].request_key;
            await rejects(command(b, {requestKey: committed}), 'DUPLICATE_REQUEST'); await rejects(command(b), 'BATTLE_FINISHED');
            assert.equal((await current()).death_count, count + 1);
            assert.equal((await pool.query('select quantity from public.inventory where character_id=$1 and item_id=$2', [character.id, item.id])).rows[0].quantity, 2);
        });
        await t.test('low positive blood attacks are free; item before damage', async () => {
            let b = await start(); await pool.query('update public.game_character set blood=4 where id=$1', [character.id]);
            const first = await command(b); b = first.battle; assert.equal(first.character.blood, 4);
            await pool.query('update public.game_character set blood=5 where id=$1', [character.id]);
            const r = await command(b); assert.equal(r.character.status, 'ALIVE'); assert.equal(r.character.blood, 5); assert.equal(r.battle.battle_status, 'ACTIVE');
            b = await start(); await pool.query('update public.game_character set blood=5 where id=$1', [character.id]);
            await pool.query('insert into public.inventory(character_id,item_id,quantity) values($1,$2,1)', [character.id, pack.id]);
            const used = await command(b, {action: 'ITEM', itemId: pack.id}); assert.equal(used.character.blood, 35); assert.equal(used.character.hp, 89);
            await rejects(command(used.battle, {action: 'ITEM', itemId: pack.id}), 'NOT_ENOUGH_ITEMS');
        });
        await t.test('timeout from start/last command persists without resource changes, concurrent sweeps once', async () => {
            let b = await start(); await pool.query("update public.battle set started_at=now()-interval '25 hours' where id=$1", [b.id]);
            const before = await current(); await Promise.all([repo.expireBattles(), repo.expireBattles()]);
            assert.equal((await repo.getBattle(user.id, b.id)).battle.end_reason, 'TIMEOUT'); assert.deepEqual(await current(), before);
            assert.equal((await pool.query("select count(*)::int n from public.action_log where target_id=$1 and action_type='BATTLE_TIMEOUT'", [b.id])).rows[0].n, 1);
            b = await start(); await pool.query("update public.battle set last_command_at=now()-interval '24 hours' where id=$1", [b.id]);
            assert.equal((await command(b)).battle.end_reason, 'TIMEOUT');
        });
        await t.test('failure rolls back resources, inventory, turn, logs; retry succeeds', async () => {
            const b = await start(); await pool.query('update public.battle set monster_hp=1 where id=$1', [b.id]);
            const before = await current(), key = randomUUID(); failLog = true;
            try {await assert.rejects(command(b, {requestKey: key}), /injected/);} finally {failLog = false;}
            assert.deepEqual(await current(), before); assert.equal((await repo.getBattle(user.id, b.id)).battle.turn_no, 1);
            assert.equal((await command(b, {requestKey: key})).battle.battle_status, 'VICTORY');
        });
        await t.test('revival uses configured v0.2 blood 50', async () => {
            const provider = (await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi) values('DEV provider','B',12,12,12) returning *")).rows[0];
            await pool.query('update public.auth_user set character_id=$1 where id=$2', [provider.id, other.id]);
            await pool.query("update public.game_character set hp=0,blood=0,status='DEAD' where id=$1", [character.id]);
            const care = createCharacterCareService(createCharacterCareRepository(pool));
            const r = await care.revive(other.id, character.id, {requestKey: randomUUID()}); assert.equal(r.target.blood, 50); assert.equal(r.target.hp, 100); assert.equal(r.provider.blood, 70);
        });
        await t.test('concurrent admin edit and investigation complete without mixed snapshots', async () => {
            await pool.query("update public.battle set battle_status='DEFEAT' where character_id=$1", [character.id]);
            await pool.query("update public.game_character set hp=100,blood=100,ap=10,status='ALIVE' where id=$1", [character.id]);
            await Promise.all([masters.saveAdminMonster(admin.id, monster.id, {...monsterBody, atk: 25, requestKey: randomUUID()}), investigation.investigate(user.id, area.id, randomUUID())]);
            const b = (await repo.getBattle(user.id)).battle; assert.ok([20, 25].includes(b.monster_atk)); assert.equal(b.monster.atk, b.monster_atk);
        });
        await t.test('heal cost, max HP, near-death transition and duplicate request remain atomic', async () => {
            await pool.query("update public.battle set battle_status='FLED' where character_id=$1", [character.id]);
            await pool.query("update public.game_character set hp=95,blood=10,status='ALIVE' where id=$1", [character.id]);
            const care = createCharacterCareService(createCharacterCareRepository(pool)), key = randomUUID();
            const result = await care.heal(user.id, character.id, {requestKey: key});
            assert.equal(result.provider.blood, 0); assert.equal(result.target.hp, 100); assert.equal(result.provider.status, 'NEAR_DEATH');
            await rejects(care.heal(user.id, character.id, {requestKey: key}), 'DUPLICATE_REQUEST');
            await pool.query("update public.game_character set hp=50,blood=9,status='ALIVE' where id=$1", [character.id]);
            await rejects(care.heal(user.id, character.id, {requestKey: randomUUID()}), 'NOT_ENOUGH_BLOOD');
            assert.equal((await current()).blood, 9); assert.equal((await current()).hp, 50);
        });
        await t.test('v0.2 active battle guards and near-death shop/storage/transfer, private gacha catalog', async () => {
            await start();
            const shop = createShopRepository(pool), store = createInventoryRepository(pool), packs = createBloodPackRepository(pool);
            const gacha = createGachaRepository(pool, {random: () => 0}), training = createTrainingRepository(pool, {random: () => 0});
            const product = (await pool.query('insert into public.shop_product(item_id,price) values($1,1) returning *', [pack.id])).rows[0];
            await pool.query("update public.item set effect_type=null where id=$1", [pack.id]);
            for (const action of [() => shop.buyProduct(user.id, product.id, 1, randomUUID()),
            () => store.deposit(user.id, pack.id, 1, randomUUID()), () => store.withdraw(user.id, pack.id, 1, randomUUID()),
            () => gacha.drawGacha(user.id, '1', randomUUID()), () => training.trainCharacter(user.id, randomUUID())]) {
                await rejects(action(), 'BATTLE_ACTIVE');
            }
            const care = createCharacterCareService(createCharacterCareRepository(pool));
            await pool.query("update public.game_character set status='DEAD',hp=0 where id=(select character_id from public.auth_user where id=$1)", [other.id]);
            const target = (await pool.query('select character_id from public.auth_user where id=$1', [other.id])).rows[0].character_id;
            await rejects(care.revive(user.id, target, {requestKey: randomUUID()}), 'PROVIDER_IN_ACTIVE_BATTLE');
            await pool.query("update public.battle set battle_status='FLED' where character_id=$1", [character.id]);
            await pool.query("update public.game_character set status='NEAR_DEATH',blood=0,currency=10 where id=$1", [character.id]);
            await shop.buyProduct(user.id, product.id, 1, randomUUID());
            await store.deposit(user.id, pack.id, 1, randomUUID());
            await store.withdraw(user.id, pack.id, 1, randomUUID());
            await pool.query("update public.item set effect_type='BLOOD_PACK',effect_value=10 where id=$1", [pack.id]);
            await pool.query("update public.game_character set status='NEAR_DEATH',hp=100,blood=0 where id=$1", [target]);
            await packs.transferBloodPack(user.id, target, pack.id, 1, randomUUID());
            const healed = await packs.useBloodPack(other.id, pack.id, randomUUID());
            assert.equal(healed.blood, 10); assert.equal(healed.status, 'ALIVE');
            const g = (await pool.query("insert into public.gacha(name) values('isolated hidden rewards') returning *")).rows[0];
            assert.equal(g.price, 1);
            const rp = (await pool.query("insert into public.item(name,category,transferable,usable,battle_usable,use_target) values('RP','ETC',true,false,false,'NONE') returning id")).rows[0];
            await pool.query('insert into public.gacha_reward(gacha_id,item_id,quantity,weight,max_stock,remaining_stock) values($1,$2,1,17,2,2)', [g.id, rp.id]);
            const catalog = (await gacha.getGachaCatalog(other.id)).gachas;
            assert.equal('rewards' in catalog[0], false);
            await pool.query('update public.game_character set currency=10 where id=$1', [target]);
            const drawn = await gacha.drawGacha(other.id, g.id, randomUUID());
            assert.equal(drawn.currency, 9); assert.equal('weight' in drawn.reward, false); assert.equal('totalWeight' in drawn.reward, false);
        });
        await t.test('midnight defeat rolls back with logs, preserves prior rewards and serializes with a command', async () => {
            const prepare = async () => {
                const b = await start();
                await pool.query("update public.game_character set blood=5,created_at=now()-interval '3 days',death_count=0,revive_count=0 where id=$1", [character.id]);
                await pool.query("update public.action_log set created_at=now()-interval '2 days'");
                await pool.query('delete from public.daily_reset_run');
                await pool.query(`insert into public.daily_reset_state(singleton,start_date,last_completed_date)
                    values(true,(clock_timestamp() at time zone 'Asia/Seoul')::date,null)
                    on conflict(singleton) do update set start_date=excluded.start_date,last_completed_date=null`);
                return b;
            };
            let b = await prepare();
            const rewardsBefore = (await pool.query('select * from public.inventory where character_id=$1 order by item_id', [character.id])).rows;
            failLog = true;
            await assert.rejects(createDailyRecovery(pool)(), /injected log failure/);
            failLog = false;
            assert.equal((await current()).blood, 5);
            await rejects(repo.getBattle(user.id, b.id), 'DAILY_RESET_REQUIRED');
            assert.equal((await pool.query('select battle_status from public.battle where id=$1', [b.id])).rows[0].battle_status, 'ACTIVE');
            assert.equal((await pool.query("select 1 from public.battle_log where battle_id=$1 and action_type='MIDNIGHT_DEFEAT'", [b.id])).rowCount, 0);

            let locked, release, attempted;
            const lockedPromise = new Promise(r => locked = r), gate = new Promise(r => release = r), attempt = new Promise(r => attempted = r);
            const gated = (reset) => ({                
...pool, async connect() {                    
const c = await pool.connect(); return {                        
release: () => c.release(), async query(q, p) {
                            if (!reset && q.includes('from public.daily_reset_state')) attempted();
                            const result = await c.query(q, p);
                            if (reset && q.includes('select * from public.game_character order by id for update')) {locked(); await gate;}
                            return result;
                        }                    
};                
}            
});
            const resetPromise = createDailyRecovery(gated(true))();
            await lockedPromise;
            const commandPromise = createBattleRepository(gated(false)).commandBattle(user.id, b.id, {requestKey: randomUUID(), turnNo: b.turn_no, action: 'ATTACK'});
            const commandCheck = rejects(commandPromise, 'BATTLE_FINISHED');
            await attempt; release();
            await resetPromise; await commandCheck;
            assert.equal((await current()).blood, 0); assert.equal((await current()).status, 'NEAR_DEATH');
            const ended = (await repo.getBattle(user.id, b.id)).battle;
            assert.equal(ended.battle_status, 'DEFEAT'); assert.equal(ended.end_reason, 'MIDNIGHT_NEAR_DEATH');
            assert.equal((await pool.query("select 1 from public.battle_log where battle_id=$1 and action_type='MIDNIGHT_DEFEAT'", [b.id])).rowCount, 1);
            assert.equal((await pool.query("select 1 from public.action_log where target_id=$1 and action_type='BATTLE_MIDNIGHT_DEFEAT'", [b.id])).rowCount, 1);
            assert.deepEqual((await pool.query('select * from public.inventory where character_id=$1 order by item_id', [character.id])).rows, rewardsBefore);
            await Promise.all([createDailyRecovery(pool)(), createDailyRecovery(pool)(), repo.expireBattles()]);
            assert.equal((await pool.query("select 1 from public.battle_log where battle_id=$1 and action_type='MIDNIGHT_DEFEAT'", [b.id])).rowCount, 1);
        });
    } finally {await raw.query(`drop schema ${schema} cascade`); await raw.end();}
});
