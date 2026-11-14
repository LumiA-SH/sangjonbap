import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';
import {validateAdminInput} from '../src/modules/admin/service.js';

test('admin schema-based input validation and nullable limits', () => {
    const key = randomUUID();

    assert.equal(
        validateAdminInput('products', {
            item_id: '1',
            price: 0,
            purchase_limit: null,
            stock_limit: null,
            requestKey: key
        }, true).patch.stock_limit,
        null
    );

    for (const body of [
        {name: '', category: 'ETC'},
        {name: 'a', category: 'BAD'},
        {name: 'a', category: 'ETC', effect_type: 'hack'},
        {is_active: 'yes'}
    ]) {
        assert.throws(
            () => validateAdminInput('items', {...body, requestKey: key}, true),
            e => e.code === 'INVALID_ADMIN_INPUT'
        );
    }

    for (const patch of [
        {price: -1},
        {purchase_limit: 0},
        {stock_limit: -1},
        {item_id: 1}
    ]) {
        assert.throws(() => validateAdminInput('products', {...patch, requestKey: key}, false));
    }
});

test('admin routes deny guests and USER, re-read role/revocation; DEV production disabled', async t => {
    const repo = createMemoryRepository('1');
    let role = 'USER';

    repo.getUser = async () => ({id: '1', is_active: true, role});
    repo.searchAdminItems = async q => [{id: '9', name: q, category: 'ETC'}];
    repo.listAdminRecords = async () => [];
    repo.getAdminRecord = async () => ({id: '2'});
    repo.saveAdminRecord = async () => ({id: '2'});

    const config = {
        nodeEnv: 'development',
        provider: 'dev',
        userId: '1',
        loginKey: 'dev-test-only-key',
        origin: 'http://localhost:3000'
    };

    const server = createApp(config, repo).listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    t.after(() => new Promise(r => server.close(r)));

    const base = `http://127.0.0.1:${server.address().port}/api`;

    const login = await fetch(base + '/auth/dev/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({key: config.loginKey})
    });

    const headers = {
        Authorization: `Bearer ${(await login.json()).data.token}`,
        'Content-Type': 'application/json'
    };

    const endpoints = [
        ['GET', '/admin/content/world'],
        ['PATCH', '/admin/content/world'],
        ['GET', '/admin/content/system'],
        ['PATCH', '/admin/content/system'],
        ['GET', '/admin/content/schedule'],
        ['PATCH', '/admin/content/schedule'],
        ['GET', '/admin/policies/donation'],
        ['PATCH', '/admin/policies/donation'],
        ['GET', '/admin/items/search?q=a'],
        ['GET', '/admin/access'],
        ['GET', '/admin/items'],
        ['GET', '/admin/items/2'],
        ['POST', '/admin/items'],
        ['PATCH', '/admin/items/2'],
        ['GET', '/admin/products'],
        ['POST', '/admin/products'],
        ['PATCH', '/admin/products/2']
    ];

    endpoints.push(
        ['GET', '/admin/storage'],
        ['PATCH', '/admin/storage/1'],
        ['GET', '/admin/clues'],
        ['POST', '/admin/clues'],
        ['GET', '/admin/clues/1'],
        ['PATCH', '/admin/clues/1'],
        ['GET', '/admin/characters/1/details'],
        ['PATCH', '/admin/characters/1/details'],
        ['GET', '/admin/monsters'],
        ['POST', '/admin/monsters'],
        ['PATCH', '/admin/monsters/1'],
        ['GET', '/admin/battle-abilities'],
        ['PATCH', '/admin/battle-abilities'],
        ['GET', '/admin/users/1/verified-account'],
        ['POST', '/admin/users/1/character']
    );

    for (const [method, path] of endpoints) {
        assert.equal((await fetch(base + path, {method})).status, 401);
        assert.equal((await fetch(base + path, {method, headers})).status, 403);
    }

    role = 'ADMIN';

    assert.equal((await fetch(base + '/admin/items/search?q=a', {headers})).status, 200);
    assert.equal((await fetch(base + '/admin/items/search?q=', {headers})).status, 400);
    assert.equal((await fetch(base + '/admin/items', {headers})).status, 200);

    assert.equal((await fetch(base + '/admin/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            name: 'a',
            category: 'ETC',
            requestKey: randomUUID()
        })
    })).status, 201);

    role = 'USER';
    assert.equal((await fetch(base + '/admin/items', {headers})).status, 403);

    config.nodeEnv = 'production';

    assert.equal((await fetch(base + '/auth/dev/login', {
        method: 'POST',
        headers,
        body: JSON.stringify({key: config.loginKey})
    })).status, 403);

    assert.equal((await fetch(base + '/admin/items', {headers})).status, 503);
});