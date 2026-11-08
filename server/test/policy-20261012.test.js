import {dailyGateFixture} from './daily-gate-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInitialStats} from '../src/modules/character/initial-stats.js';
import {validateBloodPack,isBloodPack,createBloodPackRepository} from '../src/modules/inventory/blood-pack.js';
import {validateAdminInput} from '../src/modules/admin/service.js';
import {randomUUID} from 'node:crypto';
import {kstDate} from '../src/modules/daily/date.js';

test('doubled initial stats validate B/A/S sums and integer limits without rewriting characters',()=>{
    for(const [grade,stats] of [['B',{atk:12,def:12,agi:12}],['A',{atk:10,def:10,agi:20}],['S',{atk:15,def:15,agi:15}]])assert.deepEqual(validateInitialStats(grade,stats),stats);
    for(const stats of [{atk:7,def:14,agi:15},{atk:12.5,def:11.5,agi:12},{atk:10,def:10,agi:10}])assert.throws(()=>validateInitialStats('B',stats));
});
test('blood pack uses explicit effect, daily limit separate from lifetime and KST midnight',()=>{
    assert.equal(isBloodPack({name:'혈액팩',effect_type:null}),false);
    assert.doesNotThrow(()=>validateBloodPack({name:'anything',is_active:true,effect_type:'BLOOD_PACK',effect_value:30,usable:true,use_target:'SELF',transferable:true}));
    assert.throws(()=>validateBloodPack({effect_type:'BLOOD_PACK',effect_value:31}));
    const patch=validateAdminInput('products',{item_id:'1',price:0,purchase_limit:null,daily_limit:1,requestKey:randomUUID()},true).patch;
    assert.equal(patch.purchase_limit,null);assert.equal(patch.daily_limit,1);
    assert.equal(kstDate('2026-10-11T14:59:59.999Z'),'2026-10-11');assert.equal(kstDate('2026-10-11T15:00:00Z'),'2026-10-12');
});
test('combat blood-pack use stays HOLD until the own-turn contract can be enforced',async()=>{
    for(const status of ['ALIVE','NEAR_DEATH']) {
        const statements=[];
        const client={release(){},async query(sql){const dailyGateResult=dailyGateFixture(sql);if(dailyGateResult)return dailyGateResult;
            statements.push(sql);
            if(sql.includes('join public.auth_user'))return {rows:[{id:'1',status,hp:100,blood:status==='ALIVE'?30:0}],rowCount:1};
            if(sql.includes('public.battle'))return {rows:[{id:'2'}],rowCount:1};
            return {rows:[],rowCount:0};
        }};
        const repo=createBloodPackRepository({connect:async()=>client});
        await assert.rejects(repo.useBloodPack('1','2',randomUUID()),{code:'ITEM_BATTLE_POLICY_HOLD'});
        assert.ok(statements.includes('rollback'));
        assert.ok(!statements.some(sql=>sql.includes('update public.')||sql.includes('insert into public.')));
    }
});
