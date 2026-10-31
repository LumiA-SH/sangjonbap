import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../src/config/env.js';
import {createPool} from '../src/db/pool.js';
import {createDevRepository} from '../src/modules/dev/repository.js';

test('DEV logs SQL returns own latest 30 with stable sorting and exact request filter', {
    skip: process.env.RUN_DEV_LOGS_DB_TESTS !== '1'
}, async () => {
    const pool = createPool(loadConfig());
    const client = await pool.connect();
    try {
        await client.query('begin');
        const ids = [];
        for (let i = 0; i < 2; i++) ids.push((await client.query(`insert into public.game_character(name,hunter_grade,atk,def,agi)
            values ('DEV log rollback','B',10,10,10) returning id`)).rows[0].id);
        const user = (await client.query("insert into public.auth_user(character_id,role) values ($1,'USER') returning id", [ids[0]])).rows[0];
        const key = randomUUID();
        for (let i = 0; i < 32; i++) await client.query(`insert into public.action_log(character_id,category,action_type,description,detail,request_key)
            values ($1,'CHARACTER','HEAL',$2,'{}'::jsonb,$3)`, [ids[0], String(i), i === 31 ? key : null]);
        await client.query("insert into public.action_log(character_id,category,action_type,description) values ($1,'CHARACTER','DEATH','foreign private log')", [ids[1]]);
        const repo = createDevRepository(client);
        const logs = await repo.getDevActionLogs(user.id);
        assert.equal(logs.length, 30);
        assert.equal(logs[0].description, '31');
        assert.equal(logs[29].description, '2');
        assert.ok(logs.every(log => log.character_id === ids[0]));
        assert.equal((await repo.getDevActionLogs(user.id, key)).length, 1);
    } finally { await client.query('rollback'); client.release(); await pool.end(); }
});
