import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createShopService} from '../src/modules/shop/service.js';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';

test('shop validation: quantity, UUID, bigint and forged fields; memory unavailable', async () => {
    const service = createShopService({});
    for (const quantity of [0, -1, 1.5, '2', 2147483648]) {
        await assert.rejects(service.buy('1', '1', {quantity, requestKey: randomUUID()}), e => e.code === 'INVALID_PURCHASE');
    }
    await assert.rejects(service.buy('1', '1', {quantity: 1, requestKey: 'bad'}), e => e.code === 'INVALID_REQUEST_KEY');
    await assert.rejects(service.buy('1', '1', {quantity: 1, requestKey: randomUUID(), characterId: '2'}), e => e.code === 'INVALID_PURCHASE');
    await assert.rejects(service.buy('1', '9223372036854775808', {quantity: 1, requestKey: randomUUID()}), e => e.code === 'INVALID_PRODUCT_ID');
    await assert.rejects(service.getProducts('1'), e => e.code === 'SHOP_UNAVAILABLE');
});

test('shop HTTP authenticates and uses session user; response and errors use existing envelope', async t => {
    const repository = createMemoryRepository('1'); const calls = [];
    repository.getShopProducts = async userId => {calls.push(userId); return [{id: '3', personalRemaining: null, globalRemaining: 1}];};
    repository.buyProduct = async (...args) => {calls.push(args); return {quantity: args[2]};};
    const config = {nodeEnv: 'development', provider: 'dev', userId: '1', loginKey: 'dev-test-only-key', origin: 'http://localhost:3000'};
    const server = createApp(config, repository).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    assert.equal((await fetch(base + '/shop/products')).status, 401);
    const login = await fetch(base + '/auth/dev/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: config.loginKey})});
    const headers = {Authorization: `Bearer ${(await login.json()).data.token}`, 'Content-Type': 'application/json'};
    assert.equal((await (await fetch(base + '/shop/products', {headers})).json()).data.products[0].globalRemaining, 1);
    const requestKey = randomUUID();
    const response = await fetch(base + '/shop/products/3/buy', {method: 'POST', headers, body: JSON.stringify({quantity: 2, requestKey})});
    assert.equal(response.status, 200); assert.equal((await response.json()).data.quantity, 2);
    assert.deepEqual(calls, ['1', ['1', '3', 2, requestKey]]);
});
