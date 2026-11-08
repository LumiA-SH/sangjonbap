import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool as createPool} from './isolated-pool.js';
import {createShopRepository} from '../src/modules/shop/repository.js';

test('PostgreSQL shop isolated purchases and concurrency', {skip: process.env.RUN_SHOP_DB_TESTS !== '1'}, async t => {
    const pool = createPool();
    const ids = [], users = [], products = [];
    let itemId;
    let setupDone = false;
    const setup = await pool.connect();
    try {
        await setup.query('begin');
        for (let i=0;i<2;i++) {
            const c = (await setup.query("insert into public.game_character(name,hunter_grade,atk,def,agi,currency) values ($1,'B',5,5,5,1000) returning id", [`DEV shop test ${randomUUID()}`])).rows[0];
            ids.push(c.id);
            users.push((await setup.query("insert into public.auth_user(character_id,role) values ($1,'USER') returning id", [c.id])).rows[0].id);
        }
        itemId = (await setup.query("insert into public.item(name,category) values ($1,'ETC') returning id", [`DEV shop item ${randomUUID()}`])).rows[0].id;
        for (let i=0;i<2;i++) products.push((await setup.query('insert into public.shop_product(item_id,price) values ($1,10) returning id', [itemId])).rows[0].id);
        await setup.query('commit');
        setupDone = true;
    } catch (e) { await setup.query('rollback'); throw e; }
    finally { setup.release(); if (!setupDone) await pool.end(); }
    const repo = createShopRepository(pool);
    const buy = (i=0,q=1,key=randomUUID(),p=products[0]) => repo.buyProduct(users[i],p,q,key);
    const rejects = (promise,code) => assert.rejects(promise, e => e.code === code);
    const snapshot = async () => ({
        chars: (await pool.query('select id,currency from public.game_character where id=any($1::bigint[]) order by id', [ids])).rows,
        inventory: (await pool.query('select character_id,quantity from public.inventory where character_id=any($1::bigint[]) order by character_id', [ids])).rows,
        purchases: (await pool.query('select id,quantity from public.shop_purchase where product_id=any($1::bigint[]) order by id', [products])).rows,
        logs: (await pool.query('select id from public.action_log where character_id=any($1::bigint[]) order by id', [ids])).rows
    });
    async function scenario(name, fn) {
        await t.test(name, async () => {
            await pool.query('delete from public.shop_purchase where product_id=any($1::bigint[])', [products]);
            await pool.query('delete from public.action_log where character_id=any($1::bigint[])', [ids]);
            await pool.query('delete from public.inventory where character_id=any($1::bigint[])', [ids]);
            await pool.query("update public.game_character set currency=1000,status='ALIVE',hp=100,blood=100 where id=any($1::bigint[])", [ids]);
            await pool.query('update public.shop_product set purchase_limit=null,stock_limit=null,price=10,is_active=true where id=any($1::bigint[])', [products]);
            await fn();
        });
    }
    try {
        await scenario('unlimited purchase debits, grants, logs and lists accurate remaining', async () => {
            const result = await buy(0,3);
            assert.equal(result.currency,970); assert.equal(result.inventoryQuantity,3);
            assert.equal(result.personalRemaining,null); assert.equal(result.globalRemaining,null);
            const list = await repo.getShopProducts(users[0]);
            assert.equal(list.find(p=>p.id===products[0]).globalRemaining,null);
            const s = await snapshot(); assert.equal(s.purchases.length,1); assert.equal(s.logs.length,1);
        });
        await scenario('personal lifetime limit persists after inventory is consumed; other character independent', async () => {
            await pool.query('update public.shop_product set purchase_limit=2 where id=$1',[products[0]]);
            await buy(0,2);
            await pool.query('delete from public.inventory where character_id=$1',[ids[0]]);
            await rejects(buy(),'PERSONAL_LIMIT_EXCEEDED');
            await buy(1,2);
            assert.equal((await repo.getShopProducts(users[0])).find(p=>p.id===products[0]).personalRemaining,0);
        });
        await scenario('global limit only and both limits enforced independently', async () => {
            await pool.query('update public.shop_product set stock_limit=3,purchase_limit=2 where id=$1',[products[0]]);
            await buy(0,2);
            await rejects(buy(),'PERSONAL_LIMIT_EXCEEDED');
            await rejects(buy(1,2),'OUT_OF_STOCK');
            await pool.query('update public.shop_product set purchase_limit=null where id=$1',[products[0]]);
            const r = await buy(1); assert.equal(r.globalRemaining,0);
            await rejects(buy(),'OUT_OF_STOCK');
        });
        await scenario('last stock concurrent buyers: one purchase, one charge, one grant', async () => {
            await pool.query('update public.shop_product set stock_limit=1 where id=$1',[products[0]]);
            const results = await Promise.allSettled([buy(0),buy(1)]);
            assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
            assert.equal(results.find(r=>r.status==='rejected').reason.code,'OUT_OF_STOCK');
            const s=await snapshot(); assert.equal(s.purchases.length,1); assert.equal(s.logs.length,1);
            assert.equal(s.chars.reduce((n,c)=>n+c.currency,0),1990); assert.equal(s.inventory[0].quantity,1);
        });
        await scenario('concurrent personal limit and same character different products serialize', async () => {
            await pool.query('update public.shop_product set purchase_limit=1 where id=$1',[products[0]]);
            assert.equal((await Promise.allSettled([buy(),buy()])).filter(r=>r.status==='fulfilled').length,1);
            await pool.query('update public.game_character set currency=10 where id=$1',[ids[0]]);
            await pool.query('update public.shop_product set purchase_limit=null where id=$1',[products[0]]);
            assert.equal((await Promise.allSettled([buy(),buy(0,1,randomUUID(),products[1])])).filter(r=>r.status==='fulfilled').length,1);
        });
        await scenario('same UUID concurrent and altered payload reuse never buy twice', async () => {
            const key=randomUUID();
            assert.equal((await Promise.allSettled([buy(0,1,key),buy(0,1,key)])).filter(r=>r.status==='fulfilled').length,1);
            await rejects(buy(0,2,key),'DUPLICATE_REQUEST');
            await rejects(buy(1,1,key,products[1]),'DUPLICATE_REQUEST');
            assert.equal((await snapshot()).purchases.length,1);
        });
        await scenario('same UUID on different products and characters rolls back unique loser', async () => {
            const key=randomUUID();
            assert.equal((await Promise.allSettled([buy(0,1,key),buy(1,1,key,products[1])])).filter(r=>r.status==='fulfilled').length,1);
            const s=await snapshot(); assert.equal(s.purchases.length,1); assert.equal(s.chars.reduce((n,c)=>n+c.currency,0),1990);
        });
        await scenario('insufficient currency and DEAD/NEAR_DEATH make no partial changes', async () => {
            await pool.query('update public.game_character set currency=0 where id=$1',[ids[0]]);
            let before=await snapshot(); await rejects(buy(),'NOT_ENOUGH_CURRENCY'); assert.deepEqual(await snapshot(),before);
            await pool.query("update public.game_character set status='DEAD' where id=$1",[ids[0]]);
            await rejects(buy(),'CHARACTER_DEAD');
            await pool.query("update public.game_character set status='NEAR_DEATH' where id=$1",[ids[0]]);
            await rejects(buy(),'NOT_ENOUGH_CURRENCY');
            assert.equal((await snapshot()).purchases.length,0);
        });
        await scenario('log failure rolls back currency inventory and purchase history', async () => {
            const faulty = createShopRepository({async connect() {
                const c=await pool.connect();
                return {release:()=>c.release(),query(sql,args) {
                    if (sql.includes('insert into public.action_log')) throw new Error('injected log failure');
                    return c.query(sql,args);
                }};
            }});
            const before=await snapshot();
            await assert.rejects(faulty.buyProduct(users[0],products[0],1,randomUUID()),/injected/);
            assert.deepEqual(await snapshot(),before);
            await buy();
        });
        await scenario('zero stock, inactive product and integer overflow reject safely; zero price works', async () => {
            await pool.query('update public.shop_product set stock_limit=0 where id=$1',[products[0]]);
            await rejects(buy(),'OUT_OF_STOCK');
            await pool.query('update public.shop_product set stock_limit=null,is_active=false where id=$1',[products[0]]);
            await rejects(buy(),'PRODUCT_NOT_FOUND');
            await pool.query('update public.shop_product set is_active=true,price=0 where id=$1',[products[0]]);
            assert.equal((await buy()).currency,1000);
            await pool.query('update public.inventory set quantity=2147483647 where character_id=$1 and item_id=$2',[ids[0],itemId]);
            await rejects(buy(),'INVENTORY_LIMIT_CONFLICT');
        });
    } finally {
        const c=await pool.connect();
        try {
            await c.query('begin');
            await c.query('delete from public.shop_purchase where product_id=any($1::bigint[])',[products]);
            await c.query('delete from public.action_log where character_id=any($1::bigint[])',[ids]);
            await c.query('delete from public.inventory where character_id=any($1::bigint[])',[ids]);
            await c.query('delete from public.shop_product where id=any($1::bigint[])',[products]);
            await c.query('delete from public.item where id=$1',[itemId]);
            await c.query('delete from public.auth_user where id=any($1::bigint[])',[users]);
            await c.query('delete from public.game_character where id=any($1::bigint[])',[ids]);
            await c.query('commit');
        } catch(e) { await c.query('rollback'); throw e; }
        finally {c.release(); await pool.end();}
    }
});
