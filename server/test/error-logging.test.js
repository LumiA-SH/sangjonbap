import test from 'node:test';
import assert from 'node:assert/strict';
import {developmentErrorDetails, errorHandler} from '../src/shared/http.js';

test('development diagnostics retain missing schema and stack but omit sensitive error fields', () => {
    const error = Object.assign(new Error('column s.recipe_id does not exist'), {
        code: '42703', detail: 'password=secret', query: 'select secret', connectionString: 'postgres://secret'
    });
    const details = developmentErrorDetails(error);
    assert.equal(details.code, '42703');
    assert.equal(details.message, error.message);
    assert.ok(details.stack.length);
    assert.equal(JSON.stringify(details).includes('secret'), false);
    const unsafe = developmentErrorDetails(new Error('postgres://user:secret@host Bearer token'));
    assert.equal(JSON.stringify(unsafe).includes('secret'), false);
});

test('production logging and client response never expose database exception', () => {
    const previous = console.error, logs = [];
    console.error = (...args) => logs.push(args);
    try {
        let response;
        const res = {locals: {requestId: 'test'}, status() {return this;}, json(value) {response = value;} };
        errorHandler(new Error('private database detail'), {app: {locals: {developmentErrors: false}}}, res, () => {});
        assert.deepEqual(logs, [['Request failed', 'test']]);
        assert.equal(response.error.code, 'INTERNAL_ERROR');
        assert.equal(JSON.stringify(response).includes('private'), false);
    } finally {console.error = previous;}
});
