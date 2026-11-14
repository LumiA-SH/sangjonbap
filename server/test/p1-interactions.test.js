import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as key} from 'node:crypto';
import {createIsolatedPool} from './isolated-pool.js';
import {createInteractionRepository, validateCoinTransfer} from '../src/modules/character/interactions.js';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';

test('coin input rejects forged fields and non-integer or unsafe amounts', () => {
    for (const quantity of [0, -1, 1.5, NaN, Infinity, '1', null, 2147483648]) assert.throws(() => validateCoinTransfer('2', {quantity, requestKey: key()}), {code: 'INVALID_COIN_QUANTITY'});
    for (const id of ['0', '-1', '01', '1e2', '9223372036854775808']) assert.throws(() => validateCoinTransfer(id, {quantity: 1, requestKey: key()}), {code: 'INVALID_CHARACTER_ID'});
    assert.throws(() => validateCoinTransfer('2', {quantity: 1, requestKey: key(), providerId: '3'}));
    assert.throws(() => validateCoinTransfer('2', {quantity: 1, requestKey: 'bad'}));
});
test('public routes require session, never reset, and do not permit foreign writes', async t => {
    const repo = createMemoryRepository(); let reset = 0, reads = 0;
    repo.recoverDailyReset = async () => {reset++;};
    repo.getPublicCharacter = async () => {reads++; return {character: {id: '2', status: 'DEAD'}, inventory: []};};
    repo.previewCare = async () => ({cost: 10}); repo.searchCharacters = async () => [];
    const app = createApp({mode: 'memory', origin: 'http://localhost:3000', loginKey: 'test-only-passphrase', userId: '1'}, repo);
    const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => server.close(r)));
    const base = 'http://127.0.0.1:' + server.address().port + '/api';
    assert.equal((await fetch(base + '/characters/2/public')).status, 401); assert.equal(reads, 0);
    const login = await (await fetch(base + '/auth/dev/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: 'test-only-passphrase'})})).json();
    const headers = {Authorization: 'Bearer ' + login.data.token};
    assert.equal((await fetch(base + '/characters/2/public', {headers})).status, 200);
    assert.equal((await fetch(base + '/characters/2/care-preview?action=heal', {headers})).status, 200); assert.equal((await fetch(base + '/characters/search?q=test', {headers})).status, 200); assert.equal((await fetch(base + '/characters/2/public/', {method: 'HEAD', headers})).status, 200); assert.equal(reset, 0);
    assert.equal((await fetch(base + '/characters/2/public', {method: 'PATCH', headers})).status, 404);
});
test('P1 interactions isolated PostgreSQL', {skip: !process.env.ISOLATED_PG_CONFIG}, async t => {
    const raw = createIsolatedPool(), schema = 'p1_' + key().replaceAll('-', ''); let fault = false;
    const sql = q => q.replaceAll('public.', schema + '.');
    const pool = {query: (q, p) => raw.query(sql(q), p), async connect() {const c = await raw.connect(); return {release: () => c.release(), query(q, p) {if (fault && q.includes('insert into public.action_log') && p[3] === 'COIN_RECEIVE') throw Error('receive audit fault'); return c.query(sql(q), p);} };} };
    const repo = createInteractionRepository(pool);
    try {
        await raw.query('create schema ' + schema);
        for (const {tablename} of (await raw.query("select tablename from pg_tables where schemaname='public'")).rows) await raw.query('create table ' + schema + '.' + tablename + '(like public.' + tablename + ' including all)');
        await pool.query('insert into public.daily_reset_state(singleton) values(true)');
        await raw.query('insert into ' + schema + '.system_config select * from public.system_config');
        const account = async () => {const c = (await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,hp,blood,ap,currency) values('P1 테스트','B',10,10,10,80,80,7,100) returning *")).rows[0]; const u = (await pool.query("insert into public.auth_user(role,mastodon_instance,mastodon_account_id,character_id) values('USER','test.invalid',$1,$2) returning *", [key(), c.id])).rows[0]; return {c, u};};
        const a = await account(), b = await account();
        const send = (quantity = 10, requestKey = key(), from = a, to = b) => repo.transferCoins(from.u.id, String(to.c.id), {quantity, requestKey});
        const balances = async () => (await pool.query('select currency from public.game_character where id=any($1::bigint[]) order by id', [[a.c.id, b.c.id]])).rows.map(r => r.currency);
        const reset = () => pool.query("update public.game_character set status='ALIVE',hp=80,blood=80,currency=100 where id=any($1::bigint[])", [[a.c.id, b.c.id]]);
        await t.test('normal transfer has two logs, unchanged HP/AP, duplicate retry cannot debit twice', async () => {
            const id = key(); await send(10, id); assert.deepEqual(await balances(), [90, 110]);
            const logs = (await pool.query("select character_id,action_type from public.action_log where detail->>'transferRequestKey'=$1", [id])).rows;
            assert.equal(logs.length, 2); assert.deepEqual(new Set(logs.map(l => l.action_type)), new Set(['COIN_TRANSFER', 'COIN_RECEIVE']));
            await assert.rejects(send(10, id), {code: 'DUPLICATE_REQUEST'}); assert.deepEqual(await balances(), [90, 110]);
            assert.equal((await repo.getPublicCharacter(a.u.id, String(a.c.id))).character.ap, 7);
        });
        await t.test('insufficient balance, self transfer and integer overflow roll back', async () => {
            await reset(); await assert.rejects(send(101), {code: 'NOT_ENOUGH_CURRENCY'}); await assert.rejects(send(1, key(), a, a), {code: 'SELF_TRANSFER'});
            await pool.query('update public.game_character set currency=2147483647 where id=$1', [b.c.id]); await assert.rejects(send(), {code: 'CURRENCY_LIMIT_CONFLICT'}); assert.deepEqual(await balances(), [100, 2147483647]); await reset();
        });
        await t.test('both sides near death allowed, either side dead rejected', async () => {
            await pool.query("update public.game_character set status='NEAR_DEATH',blood=0 where id=any($1::bigint[])", [[a.c.id, b.c.id]]); await send();
            for (const who of [a, b]) {await reset(); await pool.query("update public.game_character set status='DEAD',hp=0 where id=$1", [who.c.id]); await assert.rejects(send(), {code: 'CHARACTER_DEAD'}); assert.deepEqual(await balances(), [100, 100]);} await reset();
        });
        await t.test('battle on either side blocks transfer', async () => {
            const area = (await pool.query("insert into public.area(name) values('P1') returning id")).rows[0].id;
            const monster = (await pool.query("insert into public.monster(name,max_hp,atk,def,agi) values('P1',100,1,1,1) returning id")).rows[0].id;
            for (const who of [a, b]) {                
const battle = (await pool.query("insert into public.battle(character_id,monster_id,area_id,character_hp,monster_hp,monster_max_hp,monster_atk,monster_def,monster_agi,battle_status) values($1,$2,$3,80,100,100,1,1,1,'ACTIVE') returning id", [who.c.id, monster, area])).rows[0].id;
                await assert.rejects(send(), {code: 'BATTLE_ACTIVE'}); await pool.query('delete from public.battle where id=$1', [battle]);            
}
        });
        await t.test('concurrent spend, same key and reciprocal pairs preserve total (10 repetitions)', async () => {
            for (let i = 0; i < 10; i++) {
                await reset(); let results = await Promise.allSettled([send(80), send(80)]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.deepEqual(await balances(), [20, 180]);
                await reset(); const id = key(); results = await Promise.allSettled([send(10, id), send(10, id)]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.deepEqual(await balances(), [90, 110]);
                await reset(); await Promise.all([send(10), send(10, key(), b, a)]); assert.deepEqual(await balances(), [100, 100]);
            }
        });
        await t.test('second log failure rolls back both balances and first log; same key can retry', async () => {
            await reset(); const id = key(); fault = true; await assert.rejects(send(10, id), /receive audit fault/); fault = false;
            assert.deepEqual(await balances(), [100, 100]); assert.equal((await pool.query('select 1 from public.action_log where request_key=$1', [id])).rowCount, 0); await send(10, id);
        });
        await t.test('public projection is explicit and allows dead/anemic readers and targets', async () => {
            const item = (await pool.query("insert into public.item(name,category) values('공개 소지품','MATERIAL') returning id")).rows[0].id;
            await pool.query('insert into public.inventory(character_id,item_id,quantity) values($1,$2,3)', [b.c.id, item]);
            const before = (await pool.query('select count(*)::int n from public.action_log')).rows[0].n;
            for (const status of ['ALIVE', 'NEAR_DEATH', 'DEAD']) {                
await pool.query('update public.game_character set status=$1 where id=any($2::bigint[])', [status, [a.c.id, b.c.id]]);
                const result = await repo.getPublicCharacter(a.u.id, String(b.c.id)); assert.equal(result.character.status, status); assert.deepEqual(Object.keys(result.character).sort(), ['id', 'name', 'status', 'hp', 'max_hp', 'blood', 'max_blood', 'ap', 'max_ap', 'atk', 'def', 'agi', 'in_active_battle'].sort()); assert.deepEqual(result.inventory, [{itemId: String(item), name: '공개 소지품', quantity: 3}]);            
}
            assert.equal((await pool.query('select count(*)::int n from public.action_log')).rows[0].n, before);
            await assert.rejects(repo.getPublicCharacter(key(), String(b.c.id)));
            await pool.query('update public.auth_user set is_active=false where id=$1', [a.u.id]); await assert.rejects(repo.getPublicCharacter(a.u.id, String(b.c.id)), {code: 'CHARACTER_NOT_FOUND'}); await pool.query('update public.auth_user set is_active=true where id=$1', [a.u.id]); await reset();
        });
        await t.test('care preview uses configured values without mutations; self-heal and revive preserve AP', async () => {
            await reset(); const before = await balances(); let p = await repo.previewCare(a.u.id, String(a.c.id), 'heal'); assert.equal(p.cost, 10); assert.equal(p.expected.providerBlood, 70); assert.equal(p.expected.targetHp, 100);
            await pool.query("update public.system_config set config_value='13'::jsonb where config_key='heal_blood_cost'"); p = await repo.previewCare(a.u.id, String(b.c.id), 'heal'); assert.equal(p.cost, 13);
            await pool.query("update public.game_character set status='DEAD',hp=0,blood=0 where id=$1", [b.c.id]); p = await repo.previewCare(a.u.id, String(b.c.id), 'revive'); assert.equal(p.cost, 30); assert.deepEqual(p.expected, {providerBlood: 50, targetHp: 100, targetBlood: 50, targetAp: 7}); assert.deepEqual(await balances(), before);
        });
    } finally {await raw.query('drop schema if exists ' + schema + ' cascade'); await raw.end();}
});
