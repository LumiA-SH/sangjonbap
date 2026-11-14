import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCookingService} from '../src/modules/cooking/service.js';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';

test('cooking input validation rejects IDs, missing UUID and forged quantities/users', async () => {
    const service = createCookingService({});
    for (const id of ['0', '-1', '1.1', '9223372036854775808']) await assert.rejects(service.cook('1', id, {requestKey: randomUUID()}), e => e.code === 'INVALID_COOKING_ID');
    for (const body of [null, {}, [], {requestKey: 'bad'}, {requestKey: randomUUID(), quantity: 4}, {requestKey: randomUUID(), userId: '2'}]) {
        await assert.rejects(service.eat('1', '1', body), e => e.code === 'INVALID_REQUEST_KEY');
    }
    await assert.rejects(service.getCatalog('1'), e => e.code === 'COOKING_UNAVAILABLE');
});

test('cooking routes authenticate, preserve session identity and response envelope', async t => {
    const repository = createMemoryRepository('1');
    const calls = [];
    repository.getCookingCatalog = async id => {calls.push(['list', id]); return {recipes: [], foods: []};};
    for (const name of ['learnRecipe', 'cookRecipe', 'eatFood']) repository[name] = async (...args) => {calls.push([name, ...args]); return {done: true};};
    const config = {nodeEnv: 'development', provider: 'dev', userId: '1', loginKey: 'dev-test-only-key', origin: 'http://localhost:3000'};
    const server = createApp(config, repository).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    assert.equal((await fetch(base + '/cooking/catalog')).status, 401);
    const login = await fetch(base + '/auth/dev/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: config.loginKey})});
    const headers = {Authorization: `Bearer ${(await login.json()).data.token}`, 'Content-Type': 'application/json'};
    assert.equal((await fetch(base + '/cooking/catalog', {headers})).status, 200);
    for (const [path, name] of [['recipes/3/learn', 'learnRecipe'], ['recipes/3/cook', 'cookRecipe'], ['foods/3/eat', 'eatFood']]) {
        const requestKey = randomUUID();
        const response = await fetch(base + '/cooking/' + path, {method: 'POST', headers, body: JSON.stringify({requestKey: requestKey.toUpperCase()})});
        assert.equal(response.status, 200); assert.equal((await response.json()).data.done, true);
        assert.deepEqual(calls.at(-1), [name, '1', '3', requestKey]);
    }
});
