import test from 'node:test';
import assert from 'node:assert/strict';
import {recipePrice, lockRecipeDrops, filterDiscoveredRecipeDrops} from '../src/shared/recipes.js';
import {validateMasterInput} from '../src/modules/admin/master-service.js';
import {randomUUID} from 'node:crypto';

test('recipe grades have confirmed prices; missing/unknown grade has no fallback', () => {
    assert.deepEqual(['COMMON', 'RARE', 'SPECIAL'].map(recipePrice), [1, 2, 3]);
    for (const value of [null, undefined, 'LEGENDARY']) assert.throws(() => recipePrice(value), {code: 'RECIPE_GRADE_HOLD'});
    assert.equal(validateMasterInput('recipes', {discovery_grade: 'RARE', requestKey: randomUUID()}, false).patch.discovery_grade, 'RARE');
    assert.throws(() => validateMasterInput('recipes', {discovery_grade: 'OTHER', requestKey: randomUUID()}, false), {code: 'INVALID_ADMIN_INPUT'});
});

test('ordinary item drops need no recipe query; live filter only removes found recipe drops', async () => {
    const item = {item_id: '1'}, recipe = {recipe_id: '2'};
    const unused = {query() {throw Error('unexpected SQL');} };
    assert.equal((await lockRecipeDrops(unused, [item])).size, 0);
    assert.deepEqual(await filterDiscoveredRecipeDrops(unused, [item]), [item]);
    const client = {async query(q, p) {assert.deepEqual(p, [['2']]); return {rows: [{recipe_id: '2'}]};} };
    assert.deepEqual(await filterDiscoveredRecipeDrops(client, [item, recipe]), [item]);
});
