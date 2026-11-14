import test from 'node:test';
import assert from 'node:assert/strict';
import {readNumberSettings, resourceNumber} from '../src/shared/settings.js';

const clientFor = entries => ({    
async query(sql, params) {
        assert.match(sql, /where config_key=any\(\$1::text\[\]\)/);
        return {            
rows: Object.entries(entries).filter(([key]) => params[0].includes(key))
                .map(([config_key, config_value]) => ({config_key, config_value}))        
};
    }
});

test('settings reads JSONB numbers with independent number/integer requirements', async () => {
    assert.deepEqual(await readNumberSettings(clientFor({cost: 7, factor: 2.5}), {
        cost: resourceNumber, factor: {min: 0}
    }), {cost: 7, factor: 2.5});
});

test('settings missing key fails explicitly without a fallback', async () => {
    await assert.rejects(readNumberSettings(clientFor({}), {cost: resourceNumber}),
        error => error.status === 500 && error.code === 'SYSTEM_CONFIG_MISSING');
});

test('settings rejects wrong JSONB types, fractions, out-of-range and non-finite values', async () => {
    for (const value of ['10', null, true, [], {}, 1.5, -1, 2147483648, Infinity, NaN]) {
        await assert.rejects(readNumberSettings(clientFor({cost: value}), {cost: resourceNumber}),
            error => error.status === 500 && error.code === 'SYSTEM_CONFIG_INVALID');
    }
});
