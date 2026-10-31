import test from 'node:test';
import assert from 'node:assert/strict';
import {kstDate, nextDate, nextPendingDate} from '../src/modules/daily/date.js';
import {loadTrainingGrowthContext, calculateTrainingGrowth} from '../src/modules/training/growth.js';

test('KST midnight and UTC calendar boundaries are explicit', () => {
    assert.equal(kstDate('2026-10-07T14:59:59.999Z'), '2026-10-07');
    assert.equal(kstDate('2026-10-07T15:00:00Z'), '2026-10-08');
    assert.equal(kstDate('2026-12-31T15:00:00Z'), '2027-01-01');
    assert.equal(nextDate('2028-02-28'), '2028-02-29');
    assert.equal(nextDate('2028-02-29'), '2028-03-01');
    assert.throws(() => nextDate('2026-02-30'));
});

test('unconfigured start never invents historical dates; catch-up advances one day', () => {
    assert.equal(nextPendingDate(null, null, '2026-10-08'), null);
    assert.equal(nextPendingDate('2026-10-09', null, '2026-10-08'), null);
    assert.equal(nextPendingDate('2026-10-06', null, '2026-10-08'), '2026-10-06');
    assert.equal(nextPendingDate('2026-10-06', '2026-10-06', '2026-10-08'), '2026-10-07');
    assert.equal(nextPendingDate('2026-10-06', '2026-10-08', '2026-10-08'), null);
});

const settings = value => ({async query() { return {rows: [{config_key: 'permanent_stat_cap', config_value: value}]}; }});
test('training candidates exclude capped stats and growth clamps without altering input', async () => {
    const character = {atk: 20, def: 19, agi: 21};
    const context = await loadTrainingGrowthContext(settings(20), character);
    assert.deepEqual(context.candidates, ['def']);
    assert.deepEqual(calculateTrainingGrowth(character, context, 'def', 7), {stat: 'def', before: 19, after: 20, growth: 1});
    assert.equal(character.def, 19);
    assert.throws(() => calculateTrainingGrowth(character, context, 'atk', 1));
});

test('training all-capped returns growth-only skip; configurable cap is respected', async () => {
    const character = {atk: 20, def: 20, agi: 20};
    assert.equal(calculateTrainingGrowth(character, await loadTrainingGrowthContext(settings(20), character), null, 3), null);
    assert.deepEqual((await loadTrainingGrowthContext(settings(25), character)).candidates, ['atk', 'def', 'agi']);
});

test('training foundation refuses missing or invalid configuration', async () => {
    const character = {atk: 10, def: 10, agi: 10};
    await assert.rejects(loadTrainingGrowthContext({query: async () => ({rows: []})}, character), {code: 'SYSTEM_CONFIG_MISSING'});
    await assert.rejects(loadTrainingGrowthContext(settings('20'), character), {code: 'SYSTEM_CONFIG_INVALID'});
});
