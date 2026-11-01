import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../src/config/env.js';
import {createPool} from '../src/db/pool.js';
import {createPostgresRepository} from '../src/modules/character/repository.js';
import {createCharacterCareRepository} from '../src/modules/character/care-repository.js';
import {createCharacterCareService} from '../src/modules/character/care-service.js';
import {createInventoryRepository} from '../src/modules/inventory/repository.js';
import {createInvestigationRepository} from '../src/modules/investigation/repository.js';

// Opt-in. Real concurrent connections require committed fixtures. Only rows
// created here are deleted in finally; existing characters are never modified.
test('PostgreSQL character care, rollback and concurrency', {
    skip: process.env.RUN_CHARACTER_DB_TESTS !== '1'
}, async t => {
    const pool = createPool(loadConfig());
    const core = createPostgresRepository(pool);
    const service = createCharacterCareService(createCharacterCareRepository(pool));
    const inventory = createInventoryRepository(pool);
    const investigation = createInvestigationRepository(pool);
    const ids = [];
    const users = [];
    let itemId;
    let areaId;
    let monsterId;
    let battleId;
    let setupDone = false;
    const setup = await pool.connect();
    try {
        await setup.query('begin');
        for (let i = 0; i < 3; i++) {
            const character = (await setup.query(
                `insert into public.game_character(name,hunter_grade,atk,def,agi,hp,blood)
                 values ($1,'B',10,10,10,50,100) returning id`, [`DEV care test ${randomUUID()}`]
            )).rows[0];
            ids.push(character.id);
            const user = (await setup.query(
                "insert into public.auth_user(character_id,role) values ($1,'USER') returning id", [character.id]
            )).rows[0];
            users.push(user.id);
        }
        itemId = (await setup.query(
            "insert into public.item(name,category,transferable) values ($1,'ETC',true) returning id",
            [`DEV care inventory ${randomUUID()}`]
        )).rows[0].id;
        await setup.query('insert into public.inventory(character_id,item_id,quantity) values ($1,$2,3)', [ids[1], itemId]);
        areaId = (await setup.query('insert into public.area(name) values ($1) returning id',
            [`DEV care battle ${randomUUID()}`])).rows[0].id;
        monsterId = (await setup.query(
            'insert into public.monster(name,max_hp,atk,def,agi) values ($1,100,1,1,1) returning id',
            [`DEV care battle ${randomUUID()}`]
        )).rows[0].id;
        battleId = (await setup.query(
            `insert into public.battle(character_id,monster_id,area_id,character_hp,monster_hp,
                monster_max_hp,monster_atk,monster_def,monster_agi,battle_status)
             values ($1,$2,$3,50,0,100,1,1,1,'VICTORY') returning id`, [ids[1], monsterId, areaId]
        )).rows[0].id;
        await setup.query('commit');
        setupDone = true;
    } catch (error) {
        await setup.query('rollback');
        throw error;
    } finally {
        setup.release();
        if (!setupDone) await pool.end();
    }

    const get = async i => (await pool.query('select * from public.game_character where id=$1', [ids[i]])).rows[0];
    const logs = async type => (await pool.query(
        'select * from public.action_log where character_id=any($1::bigint[]) and action_type=$2', [ids, type]
    )).rows;
    const reset = async () => {
        await pool.query("update public.battle set battle_status='VICTORY' where id=$1", [battleId]);
        await pool.query('delete from public.action_log where character_id=any($1::bigint[])', [ids]);
        await pool.query(`update public.game_character set hp=50,max_hp=100,blood=100,max_blood=100,
            status='ALIVE',death_count=0,revive_count=0,is_active=true where id=any($1::bigint[])`, [ids]);
    };
    const dead = async i => pool.query("update public.game_character set hp=0,status='DEAD',death_count=1 where id=$1", [ids[i]]);
    const heal = (provider = 0, target = 1, key = randomUUID()) => service.heal(users[provider], ids[target], {requestKey: key});
    const revive = (provider = 0, target = 1, key = randomUUID()) => service.revive(users[provider], ids[target], {requestKey: key});
    const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
    async function scenario(name, fn) { await t.test(name, async () => { await reset(); await fn(); }); }

    try {
        await scenario('ACTIVE battle forbids self healing and provider healing another character',async()=>{
            await pool.query("update public.battle set battle_status='ACTIVE' where id=$1",[battleId]);
            await rejects(heal(1,1),'TARGET_IN_ACTIVE_BATTLE');
            await rejects(heal(1,0),'PROVIDER_IN_ACTIVE_BATTLE');
            assert.equal((await logs('HEAL')).length,0);
        });
        await scenario('ACTIVE battle rejects external healing with no resource or log changes', async () => {
            await pool.query("update public.battle set battle_status='ACTIVE' where id=$1", [battleId]);
            await rejects(heal(), 'TARGET_IN_ACTIVE_BATTLE');
            assert.equal((await get(0)).blood, 100);
            assert.equal((await get(1)).hp, 50);
            assert.equal((await logs('HEAL')).length, 0);
        });
        await scenario('all finished battle states allow external healing', async () => {
            for (const status of ['VICTORY', 'DEFEAT', 'FLED']) {
                await pool.query('update public.battle set battle_status=$1 where id=$2', [status, battleId]);
                await pool.query('update public.game_character set hp=50 where id=$1', [ids[1]]);
                assert.equal((await heal()).target.hp, 70);
            }
        });
        await scenario('schema permits DEAD plus ACTIVE; external revive is rejected', async () => {
            await dead(1);
            await pool.query("update public.battle set battle_status='ACTIVE' where id=$1", [battleId]);
            await rejects(revive(), 'TARGET_IN_ACTIVE_BATTLE');
            assert.equal((await get(0)).blood, 100);
            assert.equal((await get(1)).revive_count, 0);
            assert.equal((await get(1)).status, 'DEAD');
        });
        await scenario('same key reused for another target or action is rejected', async () => {
            const key = randomUUID();
            await heal(0, 1, key);
            await rejects(heal(0, 2, key), 'DUPLICATE_REQUEST');
            await dead(2);
            await rejects(revive(0, 2, key), 'DUPLICATE_REQUEST');
            assert.equal((await get(0)).blood, 90);
            assert.equal((await get(2)).revive_count, 0);
        });
        await scenario('death log failure rolls back death transition and count', async () => {
            const failingCore = createPostgresRepository({async connect() {
                const client = await pool.connect();
                return {query(sql, params) {
                    if (sql.includes('insert into public.action_log')) throw new Error('injected death log error');
                    return client.query(sql, params);
                }, release: () => client.release()};
            }});
            await assert.rejects(failingCore.changeResources(users[1], {hp: -50}, 'death rollback'), /injected death log error/);
            assert.equal((await get(1)).hp, 50);
            assert.equal((await get(1)).status, 'ALIVE');
            assert.equal((await get(1)).death_count, 0);
        });
        await scenario('DEAD remains DEAD when blood falls to zero', async () => {
            await dead(1);
            await assert.rejects(core.changeResources(users[1], {blood: -100}, 'dead blood test'),{code:'CHARACTER_DEAD'});
            const target = await get(1);
            assert.equal(target.status, 'DEAD');
            assert.equal(target.death_count, 1);
            assert.equal((await logs('DEATH')).length, 0);
        });
        await scenario('HP zero dies once, logs once and preserves inventory', async () => {
            await core.changeResources(users[1], {hp: -50}, 'death test');
            await assert.rejects(core.changeResources(users[1], {hp: -10}, 'repeated death test'),{code:'CHARACTER_DEAD'});
            const target = await get(1);
            assert.equal(target.status, 'DEAD');
            assert.equal(target.death_count, 1);
            assert.equal((await logs('DEATH')).length, 1);
            assert.equal((await pool.query('select quantity from public.inventory where character_id=$1 and item_id=$2', [ids[1], itemId])).rows[0].quantity, 3);
        });
        await scenario('blood zero becomes NEAR_DEATH, not DEAD', async () => {
            const target = await core.changeResources(users[1], {blood: -100}, 'blood test');
            assert.equal(target.status, 'NEAR_DEATH');
            assert.equal(target.death_count, 0);
            assert.equal((await logs('DEATH')).length, 0);
        });
        await scenario('heal costs 10 blood, adds 20 HP and records both before/after', async () => {
            const result = await heal();
            assert.equal(result.provider.blood, 90);
            assert.equal(result.target.hp, 70);
            const log = (await logs('HEAL'))[0];
            assert.equal(log.detail.before.provider.blood, 100);
            assert.equal(log.detail.after.target.hp, 70);
            assert.equal(log.detail.provider_id, ids[0]);
            assert.equal(log.detail.target_id, ids[1]);
        });
        await scenario('heal clamps HP to max', async () => {
            await pool.query('update public.game_character set hp=95 where id=$1', [ids[1]]);
            assert.equal((await heal()).target.hp, 100);
        });
        await scenario('insufficient healing blood makes no partial change', async () => {
            await pool.query('update public.game_character set blood=9 where id=$1', [ids[0]]);
            await rejects(heal(), 'NOT_ENOUGH_BLOOD');
            assert.equal((await get(0)).blood, 9);
            assert.equal((await get(1)).hp, 50);
            assert.equal((await logs('HEAL')).length, 0);
        });
        await scenario('healing cost can cause provider NEAR_DEATH', async () => {
            await pool.query('update public.game_character set blood=10 where id=$1', [ids[0]]);
            assert.equal((await heal()).provider.status, 'NEAR_DEATH');
            assert.equal((await get(0)).blood, 0);
        });
        await scenario('self healing merges HP and blood changes once', async () => {
            await pool.query('update public.game_character set blood=10 where id=$1', [ids[0]]);
            const result = await heal(0, 0);
            assert.deepEqual(result.provider, result.target);
            assert.equal(result.target.hp, 70);
            assert.equal(result.target.blood, 0);
            assert.equal(result.target.status, 'NEAR_DEATH');
        });
        await scenario('DEAD provider cannot heal or revive; healing cannot revive target', async () => {
            await dead(0);
            await rejects(heal(), 'CHARACTER_DEAD');
            await dead(1);
            await rejects(revive(), 'CHARACTER_DEAD');
            await rejects(heal(2, 1), 'TARGET_DEAD');
            assert.equal((await get(2)).blood, 100);
        });
        await scenario('revive restores HP/blood/status/count and charges single provider', async () => {
            await dead(1);
            const result = await revive();
            assert.equal(result.provider.blood, 70);
            assert.deepEqual(result.target, {id: ids[1], hp: 100, blood: 100, status: 'ALIVE', death_count: 1, revive_count: 1});
            assert.equal((await logs('REVIVE')).length, 1);
            assert.equal((await logs('DEATH')).length, 0);
        });
        await scenario('revive at exact cost leaves provider NEAR_DEATH', async () => {
            await dead(1);
            await pool.query('update public.game_character set blood=30 where id=$1', [ids[0]]);
            const result = await revive();
            assert.equal(result.provider.blood, 0);
            assert.equal(result.provider.status, 'NEAR_DEATH');
        });
        await scenario('insufficient revive blood rolls back without target change', async () => {
            await dead(1);
            await pool.query('update public.game_character set blood=29 where id=$1', [ids[0]]);
            await rejects(revive(), 'NOT_ENOUGH_BLOOD');
            assert.equal((await get(0)).blood, 29);
            assert.equal((await get(1)).status, 'DEAD');
            assert.equal((await get(1)).revive_count, 0);
        });
        await scenario('alive target and self revive rejected', async () => {
            await rejects(revive(), 'TARGET_NOT_DEAD');
            await dead(0);
            await rejects(revive(0, 0), 'SELF_REVIVE');
        });
        await scenario('revive max HP/blood conflict rejects before charging', async () => {
            await dead(1);
            for (const [hp, blood] of [[99, 100], [100, 49]]) {
                await pool.query('update public.game_character set max_hp=$1,max_blood=$2 where id=$3', [hp, blood, ids[1]]);
                await rejects(revive(), 'REVIVE_LIMIT_CONFLICT');
                assert.equal((await get(0)).blood, 100);
                assert.equal((await get(1)).revive_count, 0);
            }
        });
        await scenario('duplicate revive key including uppercase never charges twice', async () => {
            await dead(1);
            const key = randomUUID();
            await revive(0, 1, key);
            await rejects(revive(0, 1, key.toUpperCase()), 'DUPLICATE_REQUEST');
            assert.equal((await get(0)).blood, 70);
            assert.equal((await get(1)).revive_count, 1);
        });
        await scenario('heal request key duplicate is also prevented', async () => {
            const key = randomUUID();
            await heal(0, 1, key);
            await rejects(heal(0, 1, key), 'DUPLICATE_REQUEST');
            assert.equal((await get(0)).blood, 90);
            assert.equal((await get(1)).hp, 70);
        });
        await scenario('concurrent different providers revive once with one total charge', async () => {
            await dead(1);
            const results = await Promise.allSettled([revive(0, 1), revive(2, 1)]);
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(results.find(r => r.status === 'rejected').reason.code, 'TARGET_NOT_DEAD');
            assert.equal((await get(0)).blood + (await get(2)).blood, 170);
            assert.equal((await get(1)).revive_count, 1);
        });
        await scenario('concurrent identical request key revives once', async () => {
            await dead(1);
            const key = randomUUID();
            const results = await Promise.allSettled([revive(0, 1, key), revive(2, 1, key)]);
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(results.find(r => r.status === 'rejected').reason.code, 'DUPLICATE_REQUEST');
            assert.equal((await get(0)).blood + (await get(2)).blood, 170);
            assert.equal((await get(1)).revive_count, 1);
        });
        await scenario('opposite direction healing completes with consistent character lock order', async () => {
            await Promise.all([heal(0, 1), heal(1, 0)]);
            for (const i of [0, 1]) {
                assert.equal((await get(i)).blood, 90);
                assert.equal((await get(i)).hp, 70);
            }
        });
        await scenario('same key on disjoint characters rolls back unique constraint loser', async () => {
            const key = randomUUID();
            const results = await Promise.allSettled([heal(0, 0, key), heal(2, 2, key)]);
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(results.find(r => r.status === 'rejected').reason.code, 'DUPLICATE_REQUEST');
            assert.equal((await get(0)).blood + (await get(2)).blood, 190);
            assert.equal((await get(0)).hp + (await get(2)).hp, 120);
        });
        await scenario('log error rolls back both heal and revive mutations', async () => {
            const failingPool = {async connect() {
                const client = await pool.connect();
                return {query(sql, params) {
                    if (sql.includes('insert into public.action_log')) throw new Error('injected log error');
                    return client.query(sql, params);
                }, release: () => client.release()};
            }};
            const failing = createCharacterCareService(createCharacterCareRepository(failingPool));
            await assert.rejects(failing.heal(users[0], ids[1], {requestKey: randomUUID()}), /injected log error/);
            assert.equal((await get(0)).blood, 100);
            assert.equal((await get(1)).hp, 50);
            await dead(1);
            await assert.rejects(failing.revive(users[0], ids[1], {requestKey: randomUUID()}), /injected log error/);
            assert.equal((await get(0)).blood, 100);
            assert.equal((await get(1)).hp, 0);
            assert.equal((await get(1)).status, 'DEAD');
            assert.equal((await get(1)).revive_count, 0);
        });
        await scenario('missing/inactive target rejected without charging', async () => {
            await rejects(service.heal(users[0], '9223372036854775807', {requestKey: randomUUID()}), 'TARGET_NOT_FOUND');
            await pool.query('update public.game_character set is_active=false where id=$1', [ids[1]]);
            await rejects(heal(), 'TARGET_NOT_FOUND');
            assert.equal((await get(0)).blood, 100);
        });
        await scenario('DEAD storage actions and investigation blocked; revive enables ordinary actions', async () => {
            await dead(1);
            await rejects(inventory.deposit(users[1], itemId, 1, randomUUID()), 'CHARACTER_DEAD');
            await rejects(inventory.withdraw(users[1], itemId, 1, randomUUID()), 'CHARACTER_DEAD');
            await rejects(investigation.getInvestigationAreas(users[1]), 'CHARACTER_DEAD');
            await revive();
            assert.ok(Array.isArray(await investigation.getInvestigationAreas(users[1])));
            assert.equal((await inventory.deposit(users[1], itemId, 1, randomUUID())).type, 'OK');
            assert.equal((await inventory.withdraw(users[1], itemId, 1, randomUUID())).type, 'OK');
        });
    } finally {
        if (setupDone) {
            const cleanup = await pool.connect();
            try {
                await cleanup.query('begin');
                await cleanup.query('delete from public.battle where id=$1', [battleId]);
                await cleanup.query('delete from public.monster where id=$1', [monsterId]);
                await cleanup.query('delete from public.area where id=$1', [areaId]);
                await cleanup.query('delete from public.action_log where character_id=any($1::bigint[])', [ids]);
                await cleanup.query('delete from public.inventory where character_id=any($1::bigint[])', [ids]);
                await cleanup.query('delete from public.storage where item_id=$1', [itemId]);
                await cleanup.query('delete from public.auth_user where id=any($1::bigint[])', [users]);
                await cleanup.query('delete from public.game_character where id=any($1::bigint[])', [ids]);
                await cleanup.query('delete from public.item where id=$1', [itemId]);
                await cleanup.query('commit');
            } catch (error) { await cleanup.query('rollback'); throw error; }
            finally { cleanup.release(); await pool.end(); }
        }
    }
});
