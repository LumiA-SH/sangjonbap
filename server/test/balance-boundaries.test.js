import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTrainingGrowthContext,calculateTrainingGrowth} from '../src/modules/training/growth.js';
import {changeInventoryQuantity} from '../src/shared/game.js';
test('training cannot exceed40 even with oversized configured cap',async()=>{const c={atk:39,def:40,agi:40};const context=await loadTrainingGrowthContext({query:async()=>({rows:[{config_key:'permanent_stat_cap',config_value:50}]})},c);assert.deepEqual(context.candidates,['atk']);assert.equal(calculateTrainingGrowth(c,context,'atk',2).after,40);});
test('inventory integer bounds reject before write, retain insufficient quantity result',async()=>{let writes=0;const c={query:async q=>{if(!q.trim().startsWith('select'))writes++;return {rowCount:1,rows:[{id:'1',quantity:2147483647}]};}};await assert.rejects(changeInventoryQuantity(c,'1','1',1),e=>e.code==='INVENTORY_LIMIT_CONFLICT');assert.equal(writes,0);assert.equal((await changeInventoryQuantity(c,'1','1',-2147483648)).ok,false);assert.equal(writes,0);});
