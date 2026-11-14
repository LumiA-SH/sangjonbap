import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCharacterCareService} from '../src/modules/character/care-service.js';
import {createMemoryRepository} from '../src/db/memory.js';
import {createApp} from '../src/app.js';

test('care input validation rejects forged providers, malformed keys and unsafe IDs', async () => {
    let called = false;
    const service = createCharacterCareService({performCharacterCare() {called = true;} });
    for (const target of ['0', '-1', '1e2', '9223372036854775808', '01']) {
        await assert.rejects(service.heal('1', target, {requestKey: randomUUID()}), {code: 'INVALID_CHARACTER_ID'});
    }
    for (const body of [null, [], {}, {requestKey: 'bad'}, {requestKey: randomUUID(), providerId: '2'}]) {
        await assert.rejects(service.revive('1', '2', body), {code: 'INVALID_REQUEST_KEY'});
    }
    assert.equal(called, false);
});

test('care routes authenticate, pass session ownership and return the common envelope', async t => {
    const repository = createMemoryRepository();
    const calls = [];
    repository.performCharacterCare = async (userId, targetId, key, action) => {
        calls.push({userId, targetId, key, action});
        return {provider: {id: '1'}, target: {id: targetId}};
    };
    const config = {mode: 'memory', origin: 'http://localhost:3000', loginKey: 'test-only-passphrase', userId: '1'};
    const server = createApp(config, repository).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function post(path, body, token) {
        const response = await fetch(base + path, {            
method: 'POST', headers: {
                'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})
            }, body: JSON.stringify(body)        
});
        return {status: response.status, ...await response.json()};
    }
    assert.equal((await post('/characters/2/heal', {requestKey: randomUUID()})).status, 401);
    const token = (await post('/auth/dev/login', {key: config.loginKey})).data.token;
    for (const action of ['heal', 'revive']) {
        const key = randomUUID();
        const response = await post(`/characters/9007199254740993/${action}`, {requestKey: key}, token);
        assert.equal(response.status, 200);
        assert.equal(response.ok, true);
        assert.equal(response.data.target.id, '9007199254740993');
        assert.deepEqual(calls.at(-1), {userId: '1', targetId: '9007199254740993', key, action: action.toUpperCase()});
    }
    assert.equal((await post('/characters/2/heal', {requestKey: 'bad'}, token)).status, 400);
    delete repository.performCharacterCare;
    const unavailable = await post('/characters/2/revive', {requestKey: randomUUID()}, token);
    assert.equal(unavailable.status, 501);
});
