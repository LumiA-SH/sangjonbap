import test from 'node:test';
import assert from 'node:assert/strict';
import {victoryCurrency, guaranteedIngredient, requireIngredientDrops} from '../src/modules/battle/rewards.js';
import {planBatch} from '../src/modules/cooking/batch.js';
import {validateBalanceInput} from '../src/modules/admin/settings-repository.js';
import {validateMasterInput} from '../src/modules/admin/master-service.js';
const key = '12345678-1234-4234-8234-123456789012';
test('victory coin distribution uses exact 50 percent boundary', () => {
    for (const [roll, expected] of [[0, 1], [.499999, 1], [.5, 2], [.999999, 2]]) assert.equal(victoryCurrency(() => roll), expected);
    assert.throws(() => victoryCurrency(() => 1));
});
test('ingredient guarantee uses original relative rates and inclusive quantity bounds', () => {
    const drops = [{item_id: '1', is_ingredient: true, drop_rate: 20, min_quantity: 2, max_quantity: 4}, {item_id: '2', is_ingredient: true, drop_rate: 60, min_quantity: 1, max_quantity: 1}, {item_id: '3', is_ingredient: false, drop_rate: 100}];
    for (const [roll, id, quantity] of [[0, '1', 4], [.249999, '1', 4], [.25, '2', 1], [.9999, '2', 1]]) {
        const draws = [roll, .999999]; const result = guaranteedIngredient(drops, () => draws.shift());
        assert.equal(result.drop.item_id, id); assert.equal(result.quantity, quantity);
    }
    for (const invalid of [[], [{item_id: '1', is_ingredient: true, drop_rate: 0}]]) assert.throws(() => requireIngredientDrops(invalid), e => e.code === 'MONSTER_INGREDIENT_REQUIRED');
});
test('admin recipe settings affect next batch, while default 80 percent / 3 remains supported', () => {
    const base = {result_item_id: '2', failure_item_id: '3', success_rate: 80, result_quantity: 3};
    const ingredients = [{item_id: '1', quantity: 2}];
    const run = recipe => planBatch(recipe, ingredients, new Map([['1', 2]]), 1, () => .7);
    assert.deepEqual(run(base).outputs, [{itemId: '2', quantity: 3}]);
    assert.deepEqual(run({...base, result_quantity: 5}).outputs, [{itemId: '2', quantity: 5}]);
    assert.equal(run({...base, success_rate: 60}).failureCount, 1);
});
test('balance API whitelist prevents arbitrary config editing and invalid resource types', () => {
    assert.equal(validateBalanceInput({requestKey: key, settings: {heal_blood_cost: 7, training_great_rate_b: 25.5}}).settings.heal_blood_cost, 7);
    for (const settings of [{permanent_stat_cap: 100}, {heal_blood_cost: '10'}, {heal_hp_recovery: -1}, {training_growth: 1.5}, {training_great_rate_b: 101}, {}]) assert.throws(() => validateBalanceInput({requestKey: key, settings}));
});
test('gacha reward activation is validated and duplicate item entries rejected', () => {
    const row = {item_id: '1', quantity: 1, max_stock: 3, remaining_stock: 3, is_active: false};
    assert.equal(validateMasterInput('gachas', {requestKey: key, rewards: [row]}, false).patch.rewards[0].is_active, false);
    for (const rewards of [[row, row], [{...row, is_active: 'false'}]]) assert.throws(() => validateMasterInput('gachas', {requestKey: key, rewards}, false));
});
