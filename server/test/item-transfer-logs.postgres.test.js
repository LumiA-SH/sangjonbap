import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool} from './isolated-pool.js';
import {createInventoryRepository} from '../src/modules/inventory/repository.js';
import {createBloodPackRepository} from '../src/modules/inventory/blood-pack.js';
import {createRecordsRepository} from '../src/modules/records/repository.js';

test('transfer recipient records: PostgreSQL atomicity, ownership and retries', {skip: !process.env.ISOLATED_PG_CONFIG}, async t => {
    const raw = createIsolatedPool(), schema = 'transfer_logs_' + randomUUID().replaceAll('-', '');
    let failRecipient = false, recipientId;
    const rewrite = q => q.replaceAll('public.', schema + '.');
    const pool = {        
query: (q, p) => raw.query(rewrite(q), p), async connect() {            
const c = await raw.connect(); return {
                release: () => c.release(), query(q, p) {
                    if (failRecipient && q.includes('insert into public.action_log') && p[0] === recipientId) throw Error('recipient audit failure');
                    return c.query(rewrite(q), p);
                }
            };        
}    
};
    await raw.query(`create schema ${schema}`);
    try {
        for (const table of ['daily_reset_state', 'auth_user', 'game_character', 'item', 'inventory', 'action_log', 'battle']) await raw.query(`create table ${schema}.${table} (like public.${table} including all)`);
        await pool.query('insert into public.daily_reset_state(singleton) values(true)');
        const actors = [];
        for (const name of ['송신자', '수령자', '다른 러너']) {
            const c = (await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi) values($1,'B',12,12,12) returning *", [name])).rows[0];
            const u = (await pool.query("insert into public.auth_user(character_id,role) values($1,'USER') returning *", [c.id])).rows[0]; actors.push({c, u});
        }
        const [sender, recipient, stranger] = actors; recipientId = recipient.c.id;
        const item = (await pool.query("insert into public.item(name,category,transferable) values('테스트 물품','ETC',true) returning *")).rows[0];
        await pool.query('insert into public.inventory(character_id,item_id,quantity) values($1,$2,5)', [sender.c.id, item.id]);
        const repo = createInventoryRepository(pool), records = createRecordsRepository(pool);
        const quantities = async () => (await pool.query('select character_id,quantity from public.inventory where item_id=$1 order by character_id', [item.id])).rows;
        await t.test('both personal feeds contain names, item, amount and server timestamp; unrelated user sees neither', async () => {
            const key = randomUUID(); await repo.transferItem(sender.u.id, recipient.c.id, item.id, 2, key);
            for (const [actor, type] of [[sender, 'ITEM_TRANSFER'], [recipient, 'ITEM_RECEIVE']]) {
                const logs = await records.getActionRecords(actor.u.id); assert.equal(logs.length, 1); const log = logs[0];
                assert.equal(log.action_type, type); assert.ok(log.created_at instanceof Date);
                assert.equal(log.detail.providerId, sender.c.id); assert.equal(log.detail.targetId, recipient.c.id);
                assert.equal(log.detail.providerName, '송신자'); assert.equal(log.detail.targetName, '수령자'); assert.equal(log.detail.itemName, '테스트 물품'); assert.equal(log.detail.quantity, 2); assert.equal(log.detail.transferRequestKey, key);
            }
            assert.equal((await records.getActionRecords(stranger.u.id)).length, 0);
            assert.equal((await records.getActionRecords(sender.u.id, null, false, key)).length, 1);
            assert.equal((await records.getActionRecords(stranger.u.id, null, false, key)).length, 0);
            assert.equal((await records.getActionRecords(recipient.u.id, null, false, key)).length, 0);
            const before = await quantities(); await assert.rejects(repo.transferItem(sender.u.id, recipient.c.id, item.id, 2, key), {code: 'DUPLICATE_REQUEST'});
            assert.deepEqual(await quantities(), before); assert.equal((await pool.query('select * from public.action_log')).rowCount, 2);
        });
        await t.test('recipient log failure rolls back quantities and the already inserted sender log', async () => {
            const before = await quantities(), key = randomUUID(); failRecipient = true;
            await assert.rejects(repo.transferItem(sender.u.id, recipient.c.id, item.id, 1, key), /recipient audit failure/); failRecipient = false;
            assert.deepEqual(await quantities(), before); assert.equal((await pool.query('select * from public.action_log')).rowCount, 2);
            await repo.transferItem(sender.u.id, recipient.c.id, item.id, 1, key);
            assert.equal((await pool.query('select * from public.action_log')).rowCount, 4);
        });
        await t.test('concurrent identical requests produce one transfer and exactly one pair of logs', async () => {
            const key = randomUUID(), results = await Promise.allSettled([1, 2].map(() => repo.transferItem(sender.u.id, recipient.c.id, item.id, 1, key)));
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'DUPLICATE_REQUEST');
            assert.equal((await pool.query('select * from public.action_log')).rowCount, 6);
            assert.deepEqual((await quantities()).map(r => r.quantity), [1, 4]);
        });
        await t.test('blood-pack endpoint uses the same two-party logging without changing item effects', async () => {
            const pack = (await pool.query("insert into public.item(name,category,transferable,effect_type,effect_value,usable,use_target) values('팩','CONSUMABLE',true,'BLOOD_PACK',10,true,'SELF') returning *")).rows[0];
            await pool.query('insert into public.inventory(character_id,item_id,quantity) values($1,$2,1)', [sender.c.id, pack.id]);
            await createBloodPackRepository(pool).transferBloodPack(sender.u.id, recipient.c.id, pack.id, 1, randomUUID());
            const log = (await records.getActionRecords(recipient.u.id))[0]; assert.equal(log.action_type, 'BLOOD_PACK_RECEIVE'); assert.equal(log.detail.itemName, '팩');
            assert.equal((await pool.query('select blood from public.game_character where id=$1', [recipient.c.id])).rows[0].blood, recipient.c.blood);
        });
    } finally {await raw.query(`drop schema ${schema} cascade`); await raw.end();}
});
