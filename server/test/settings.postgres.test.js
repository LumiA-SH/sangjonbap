import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool as createPool} from './isolated-pool.js';
import {readNumberSettings, resourceNumber} from '../src/shared/settings.js';
import {createCharacterCareRepository} from '../src/modules/character/care-repository.js';
import {createCharacterCareService} from '../src/modules/character/care-service.js';
import {createInvestigationRepository} from '../src/modules/investigation/repository.js';
import {createInvestigationService} from '../src/modules/investigation/service.js';

test('PostgreSQL configuration changes are transaction-isolated and drive game results', {
    skip: process.env.RUN_SETTINGS_DB_TESTS !== '1'
}, async t => {
    const pool = createPool();
    const client = await pool.connect();
    const baseline = (await client.query('select config_key,config_value from public.system_config order by config_key')).rows;
    let configReads = 0;
    try {
        await client.query('begin');
        const characters = [];
        for (let i = 0; i < 2; i++) {
            characters.push((await client.query(`insert into public.game_character(name,hunter_grade,atk,def,agi,hp,blood,ap)
                values ('DEV settings rollback','B',10,10,10,40,100,5) returning *`)).rows[0]);
        }
        const [provider, target] = characters;
        const user = (await client.query("insert into public.auth_user(character_id,role) values ($1,'USER') returning id", [provider.id])).rows[0];
        const area = (await client.query("insert into public.area(name,is_open) values ('DEV settings rollback',true) returning id")).rows[0];
        await client.query(`insert into public.investigation_result(area_id,result_grade,result_text)
            values ($1,'NORMAL','DEV settings rollback')`, [area.id]);
        const adapter = {
            async query(sql, params) {
                if (sql === 'begin') return client.query('savepoint game_call');
                if (sql === 'commit') return client.query('release savepoint game_call');
                if (sql === 'rollback') {
                    await client.query('rollback to savepoint game_call');
                    return client.query('release savepoint game_call');
                }
                if (sql.startsWith('select config_key,config_value')) configReads++;
                return client.query(sql, params);
            },
            release() {}
        };
        const scopedPool = {connect: async () => adapter, query: (...args) => adapter.query(...args)};
        const care = createCharacterCareService(createCharacterCareRepository(scopedPool));
        const investigation = createInvestigationRepository(scopedPool, {random: () => 0});
        const set = (key, value) => client.query('update public.system_config set config_value=$2::jsonb where config_key=$1', [key, JSON.stringify(value)]);
        const get = async id => (await client.query('select * from public.game_character where id=$1', [id])).rows[0];
        const heal = () => care.heal(user.id, target.id, {requestKey: randomUUID()});
        const revive = () => care.revive(user.id, target.id, {requestKey: randomUUID()});
        async function scenario(name, fn) {
            await t.test(name, async () => {
                await client.query('savepoint scenario');
                configReads = 0;
                try { await fn(); }
                finally { await client.query('rollback to savepoint scenario'); await client.query('release savepoint scenario'); }
            });
        }
        await scenario('actual JSONB numeric setting is read', async () => {
            await set('heal_blood_cost', 7);
            assert.deepEqual(await readNumberSettings(client, {heal_blood_cost: resourceNumber}), {heal_blood_cost: 7});
        });
        await scenario('changing healing cost and recovery changes actual SQL results once', async () => {
            await set('heal_blood_cost', 7);
            await set('heal_hp_recovery', 13);
            const result = await heal();
            assert.equal(result.provider.blood, 93);
            assert.equal(result.target.hp, 53);
            assert.equal((await get(target.id)).hp, 53);
            assert.equal(configReads, 1);
        });
        await scenario('configured healing cost drives insufficient-blood rejection', async () => {
            await set('heal_blood_cost', 101);
            await assert.rejects(heal(), {code: 'NOT_ENOUGH_BLOOD'});
            assert.equal((await get(provider.id)).blood, 100);
            assert.equal((await get(target.id)).hp, 40);
        });
        await scenario('configured healing amount still clamps to max HP', async () => {
            await set('heal_hp_recovery', 80);
            assert.equal((await heal()).target.hp, 100);
        });
        await scenario('revive cost and both restore values follow settings', async () => {
            await client.query("update public.game_character set hp=0,status='DEAD' where id=$1", [target.id]);
            await set('revive_blood_cost', 17);
            await set('revive_hp', 80);
            await set('revive_blood', 35);
            const result = await revive();
            assert.equal(result.provider.blood, 83);
            assert.equal(result.target.hp, 80);
            assert.equal(result.target.blood, 35);
            assert.equal(result.target.status, 'ALIVE');
            assert.equal(result.target.revive_count, 1);
            assert.equal(configReads, 1);
        });
        await scenario('configured revive targets retain limit-conflict rejection', async () => {
            await client.query("update public.game_character set hp=0,status='DEAD' where id=$1", [target.id]);
            await set('revive_hp', 101);
            await assert.rejects(revive(), {code: 'REVIVE_LIMIT_CONFLICT'});
            assert.equal((await get(provider.id)).blood, 100);
            assert.equal((await get(target.id)).revive_count, 0);
        });
        await scenario('AP setting controls deduction and insufficient AP using one read per request', async () => {
            await set('investigation_ap_cost', 3);
            assert.equal((await investigation.investigate(user.id, area.id, randomUUID())).ap, 2);
            assert.equal(configReads, 1);
            await assert.rejects(investigation.investigate(user.id, area.id, randomUUID()), {code: 'NOT_ENOUGH_AP'});
            assert.equal((await get(provider.id)).ap, 2);
            assert.equal(configReads, 2);
            const data = await createInvestigationService(investigation).getAreas(user.id);
            assert.equal(data.investigationApCost, 3);
            assert.ok(data.areas.some(row => row.id === area.id));
        });
        await scenario('missing and malformed settings roll back without game changes', async () => {
            await client.query("delete from public.system_config where config_key='heal_blood_cost'");
            await assert.rejects(heal(), {code: 'SYSTEM_CONFIG_MISSING'});
            await set('investigation_ap_cost', '3');
            await assert.rejects(investigation.investigate(user.id, area.id, randomUUID()), {code: 'SYSTEM_CONFIG_INVALID'});
            assert.equal((await get(provider.id)).blood, 100);
            assert.equal((await get(provider.id)).ap, 5);
            assert.equal((await get(target.id)).hp, 40);
        });
        await scenario('stat CHECK allows above 20 while rejecting negative stats', async () => {
            await client.query('update public.game_character set atk=21,def=22,agi=23 where id=$1', [provider.id]);
            assert.equal((await get(provider.id)).atk, 21);
            await client.query('savepoint invalid_stat');
            await assert.rejects(client.query('update public.game_character set atk=-1 where id=$1', [provider.id]), {code: '23514'});
            await client.query('rollback to savepoint invalid_stat');
        });
    } finally {
        await client.query('rollback');
        try {
            assert.deepEqual((await client.query('select config_key,config_value from public.system_config order by config_key')).rows, baseline);
        } finally { client.release(); await pool.end(); }
    }
});
