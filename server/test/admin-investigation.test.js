import {dailyGateFixture} from './daily-gate-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAdminInvestigationOperations} from '../src/modules/admin/investigation-operations.js';
import {chooseResult,winsReward} from '../src/modules/investigation/random.js';
function fixture({failLog=false,discovered=false}={}) {
    let state={result:{id:'2',area_id:'1',result_grade:'NORMAL',result_text:'원본',weight:1,is_unique:true,investigation_rate_value:10,clue_id:null,is_active:true},rewards:[{item_id:'3',recipe_id:null,quantity:1,probability:20}]},saved;
    const rows=r=>({rows:r,rowCount:r.length}),calls=[];
    const c={release(){},async query(sql,p=[]){const dailyGateResult=dailyGateFixture(sql);if(dailyGateResult)return dailyGateResult;calls.push(sql);
        if(sql==='begin'){saved=structuredClone(state);return rows([]);}if(sql==='rollback'){state=saved;return rows([]);}if(sql==='commit')return rows([]);
        if(sql.startsWith('select id from public.action_log'))return rows([]);
        if(sql.startsWith('select id from public.'))return rows([{id:p[0]}]);
        if(sql.startsWith('select r.*'))return rows([{...state.result,rewards:structuredClone(state.rewards),discovery:discovered?{character_id:'9'}:null}]);
        if(sql.startsWith('update public.investigation_result')){['result_grade','result_text','weight','is_unique','investigation_rate_value','clue_id','is_active'].forEach((k,i)=>state.result[k]=p[i]);return rows([{...state.result}]);}
        if(sql.startsWith('delete from public.investigation_reward')){state.rewards=[];return rows([]);}
        if(sql.startsWith('insert into public.investigation_reward')){state.rewards.push({item_id:p[1],recipe_id:p[2],quantity:p[3],probability:p[4]});return rows([]);}
        if(sql.startsWith('insert into public.action_log')){if(failLog)throw Error('audit failed');return rows([]);}throw Error(sql);
    }};
    return {repo:createAdminInvestigationOperations({connect:async()=>c}),state:()=>state,calls};
}
const body=()=>({requestKey:randomUUID(),result_grade:'NORMAL',result_text:'수정',weight:9,is_unique:true,investigation_rate_value:25,clue_id:null,is_active:true,rewards:[{item_id:'3',recipe_id:null,quantity:2,probability:80}]});
test('saved result weights and independent reward probabilities feed existing game selectors',async()=>{
    const f=fixture();await f.repo.saveAdminInvestigation('a','1','2',body());
    assert.equal(chooseResult([{id:'other',weight:1},f.state().result],()=>.1).id,'2');
    assert.equal(winsReward(f.state().rewards[0].probability,()=>.79),true);assert.equal(winsReward(f.state().rewards[0].probability,()=>.8),false);
    assert.equal(f.state().result.investigation_rate_value,25);
    assert(f.calls[1].includes('public.area'));assert(!f.calls.some(sql=>/delete from public.unique_discovery/.test(sql)));
});
test('result and complete reward replacement roll back together on audit failure',async()=>{
    const f=fixture({failLog:true}),saved=structuredClone(f.state());await assert.rejects(f.repo.saveAdminInvestigation('a','1','2',body()),/audit failed/);assert.deepEqual(f.state(),saved);
});
test('already discovered unique result cannot lose its unique identity',async()=>{
    const f=fixture({discovered:true});await assert.rejects(f.repo.saveAdminInvestigation('a','1','2',{...body(),is_unique:false}),e=>e.code==='DISCOVERY_HISTORY_PRESERVED');assert.equal(f.state().result.is_unique,true);
});
