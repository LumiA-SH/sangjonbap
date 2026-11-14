
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool as createPool} from './isolated-pool.js';
import {createAdminRepository} from '../src/modules/admin/repository.js';
import {createShopRepository} from '../src/modules/shop/repository.js';

test('PostgreSQL admin writes, audit rollback and purchase concurrency', {skip: process.env.RUN_ADMIN_DB_TESTS !== '1'}, async t => {
    const pool = createPool();
    let admin, user, character, ready = false;
    const itemIds = [];
    const productIds = [];
    const c = await pool.connect();

    try {
        await c.query('begin');

        admin = (await c.query(
            "insert into public.auth_user(role) values ('ADMIN') returning id"
        )).rows[0].id;

        character = (await c.query(
            "insert into public.game_character(name,hunter_grade,atk,def,agi,currency) values ($1,'B',5,5,5,100) returning id",
            [`DEV admin test ${randomUUID()}`]
        )).rows[0].id;

        user = (await c.query(
            "insert into public.auth_user(role,character_id) values ('USER',$1) returning id",
            [character]
        )).rows[0].id;

        await c.query('commit');
        ready = true;
    } catch (e) {
        await c.query('rollback');
        throw e;
    } finally {
        c.release();
        if (!ready) await pool.end();
    }

    const repo = createAdminRepository(pool);
    const shop = createShopRepository(pool);

    const save = (kind, id, patch, key = randomUUID(), actor = admin) => repo.saveAdminRecord(actor, kind, id, patch, key);
    const rejects = (p, code) => assert.rejects(p, e => e.code === code);

    try {
        let item, product;

        await t.test('register item/product with DB defaults, detail/list and audit', async () => {
            item = await save('items', null, {
                name: `DEV admin item ${randomUUID()}`,
                category: 'ETC'
            });
            itemIds.push(item.id);
            assert.equal(item.usable, false);

            product = await save('products', null, {
                item_id: item.id,
                price: 10,
                purchase_limit: null,
                stock_limit: 5
            });
            productIds.push(product.id);

            assert.equal((await repo.getAdminRecord('products', product.id)).stock_limit, 5);
            assert.ok((await repo.listAdminRecords('items')).some(row => row.id === item.id));

            const logs = (await pool.query(
                'select * from public.action_log where admin_user_id=$1',
                [admin]
            )).rows;

            assert.equal(logs.length, 2);
            assert.equal(logs[0].detail.before, null);
        });

        await t.test('role rechecked inside transaction, duplicate key and before/after audit', async () => {
            await rejects(save('items', item.id, {name: 'forbidden'}, randomUUID(), user), 'ADMIN_REQUIRED');

            const key = randomUUID();
            await save('items', item.id, {description: 'edited'}, key);
            await rejects(save('items', item.id, {description: 'twice'}, key), 'DUPLICATE_REQUEST');

            await pool.query("update public.auth_user set role='USER' where id=$1", [admin]);
            await rejects(save('items', item.id, {description: 'revoked'}), 'ADMIN_REQUIRED');
            await pool.query("update public.auth_user set role='ADMIN' where id=$1", [admin]);
        });

        await t.test('sold stock floor, personal history remains, item replacement held', async () => {
            await shop.buyProduct(user, product.id, 2, randomUUID());
            await rejects(save('products', product.id, {stock_limit: 1}), 'STOCK_LIMIT_CONFLICT');

            await save('products', product.id, {
                stock_limit: 2,
                purchase_limit: 1
            });

            const listed = (await shop.getShopProducts(user)).find(row => row.id === product.id);
            assert.equal(listed.personalRemaining, 0);
            assert.equal(listed.globalRemaining, 0);

            const other = await save('items', null, {
                name: `DEV admin item ${randomUUID()}`,
                category: 'ETC'
            });
            itemIds.push(other.id);

            await rejects(save('products', product.id, {item_id: other.id}), 'PRODUCT_ITEM_CHANGE_HOLD');

            await save('items', item.id, {is_active: false});

            assert.equal((await pool.query(
                'select quantity from public.inventory where character_id=$1 and item_id=$2',
                [character, item.id]
            )).rows[0].quantity, 2);

            await save('items', item.id, {is_active: true});
        });

        await t.test('concurrent reduction to sold count and purchase serialize without overselling', async () => {
            await save('products', product.id, {
                stock_limit: 3,
                purchase_limit: null
            });

            const results = await Promise.allSettled([
                save('products', product.id, {stock_limit: 2}),
                shop.buyProduct(user, product.id, 1, randomUUID())
            ]);

            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);

            const sold = Number((await pool.query(
                'select sum(quantity) quantity from public.shop_purchase where product_id=$1',
                [product.id]
            )).rows[0].quantity);

            assert.ok((await repo.getAdminRecord('products', product.id)).stock_limit >= sold);
        });

        await t.test('log failure rolls back item update; missing item product cannot be created', async () => {
            const faulty = createAdminRepository({
                async connect() {
                    const c = await pool.connect();

                    return {
                        release: () => c.release(),
                        query(sql, args) {
                            if (sql.includes('insert into public.action_log')) throw new Error('injected');
                            return c.query(sql, args);
                        }
                    };
                }
            });

            const before = await repo.getAdminRecord('items', item.id);

            await assert.rejects(
                faulty.saveAdminRecord(admin, 'items', item.id, {name: 'rollback'}, randomUUID()),
                /injected/
            );

            assert.deepEqual(await repo.getAdminRecord('items', item.id), before);
            await rejects(save('products', null, {item_id: '9223372036854775807', price: 1}), 'ITEM_NOT_FOUND');
        });
    } finally {
        const c = await pool.connect();

        try {
            await c.query('begin');

            await c.query(
                'delete from public.action_log where admin_user_id=$1 or character_id=$2',
                [admin, character]
            );

            await c.query(
                'delete from public.shop_purchase where product_id=any($1::bigint[])',
                [productIds]
            );

            await c.query(
                'delete from public.inventory where character_id=$1',
                [character]
            );

            await c.query(
                'delete from public.shop_product where id=any($1::bigint[])',
                [productIds]
            );

            await c.query(
                'delete from public.item where id=any($1::bigint[])',
                [itemIds]
            );

            await c.query(
                'delete from public.auth_user where id=any($1::bigint[])',
                [[admin, user]]
            );

            await c.query(
                'delete from public.game_character where id=$1',
                [character]
            );

            await c.query('commit');
        } catch (e) {
            await c.query('rollback');
            throw e;
        } finally {
            c.release();
            await pool.end();
        }
    }
});
