import test from 'node:test';
import assert from 'node:assert/strict';
import {planBatch,validateQuantity} from '../src/modules/cooking/batch.js';
import {createCookingRepository} from '../src/modules/cooking/repository.js';
import {createCookingService} from '../src/modules/cooking/service.js';
import {validateMasterInput} from '../src/modules/admin/master-service.js';

const recipe={id:'2',is_active:true,result_item_id:'3',failure_item_id:'4',success_rate:0,result_quantity:4};
const ingredients=[{item_id:'1',quantity:3},{item_id:'2',quantity:1}];
const key='12345678-1234-4234-8234-123456789012';
test('independent 80% boundaries; success 3, failure 1; minimum-one ingredient consumption',()=>{
    const rolls=[0,.8,.799999];
    const p=planBatch(recipe,ingredients,new Map([['1',9],['2',3]]),3,()=>rolls.shift());
    assert.equal(rolls.length,0);assert.equal(p.successCount,2);assert.equal(p.failureCount,1);
    assert.deepEqual(p.consumed,[{itemId:'1',quantity:7},{itemId:'2',quantity:3}]);
    assert.deepEqual(p.outputs,[{itemId:'3',quantity:6},{itemId:'4',quantity:1}]);
    assert.deepEqual(p.attempts.map(a=>a.succeeded),[true,false,true]);
});
test('batch validates full materials before RNG and rejects invalid quantities',()=>{
    assert.throws(()=>planBatch(recipe,ingredients,new Map([['1',8],['2',3]]),3,()=>{throw Error('must not roll');}),e=>e.code==='NOT_ENOUGH_INGREDIENTS');
    for(const n of [0,-1,1.5,'2',null,1001,Infinity])assert.throws(()=>validateQuantity(n));
});
test('cook quantity is accepted only for cooking; missing quantity keeps old call shape',async()=>{
    const calls=[];
    const service=createCookingService({getCookingCatalog(){},learnRecipe(){},eatFood(){},cookRecipe(...a){calls.push(a);}});
    await service.cook('u','2',{requestKey:key,quantity:3});
    await service.cook('u','2',{requestKey:key});
    assert.deepEqual(calls,[['u','2',key,3],['u','2',key]]);
    await assert.rejects(service.learn('u','2',{requestKey:key,quantity:3}));
});
test('area editor only changes validated encounter probability; no area creation',()=>{
    assert.equal(validateMasterInput('areas',{encounter_rate:40,requestKey:key},false).patch.encounter_rate,40);
    for(const rate of [-1,101,'40',NaN])assert.throws(()=>validateMasterInput('areas',{encounter_rate:rate,requestKey:key},false));
    assert.throws(()=>validateMasterInput('areas',{encounter_rate:40,requestKey:key},true));
});

// Transaction emulator for repository control flow only; not a substitute for PostgreSQL locking tests.
function fixture({status='ALIVE',ap=10,active=false,failLog=false,foodCount=0,atk=39,random=()=>0}={}) {
    let state={character:{id:'7',hp:100,max_hp:100,blood:status==='NEAR_DEATH'?0:50,max_blood:100,ap,max_ap:10,currency:10,status,death_count:0,atk,def:10,agi:10,daily_meal_count:foodCount},inventory:{1:12,2:4,3:2},logs:[]};
    let snapshot;
    const calls=[];
    const rows=a=>({rows:a,rowCount:a.length});
    const client={release(){},async query(raw,p=[]) {
        const sql=raw.replace(/\s+/g,' ').trim();calls.push(sql);
        if(sql==='begin'){snapshot=structuredClone(state);return rows([]);}
        if(sql==='rollback'){state=snapshot;return rows([]);}
        if(sql==='commit')return rows([]);
        if(sql.startsWith('select id from public.action_log'))return rows(state.logs.filter(l=>l.requestKey===p[0]));
        if(sql.startsWith('select c.*'))return rows([{...state.character}]);
        if(sql.startsWith('select id from public.battle'))return rows(active?[{id:1}]:[]);
        if(sql.startsWith('select * from public.recipe where'))return rows([recipe]);
        if(sql.startsWith('select 1 from public.character_recipe'))return rows([{}]);
        if(sql.startsWith('select config_key,config_value'))return rows(p[0].map(config_key=>({config_key,config_value:config_key==='cooking_ap_cost'?2:40})));
        if(sql.startsWith('select * from public.recipe_ingredient'))return rows(ingredients);
        if(sql.startsWith('select * from public.item'))return rows([{id:p[0],is_active:true}]);
        if(sql.startsWith('select * from public.food_config'))return rows([{blood_recovery:10,stat_growth_enabled:true,stat_growth_target:'ATK',stat_growth_value:9,stat_growth_rate:100}]);
        if(sql.startsWith('select item_id,quantity from public.inventory'))return rows(p[1].filter(id=>state.inventory[id]!=null).map(id=>({item_id:id,quantity:state.inventory[id]})));
        if(sql.startsWith('select id,quantity from public.inventory'))return rows(state.inventory[p[1]]==null?[]:[{id:p[1],quantity:state.inventory[p[1]]}]);
        if(sql.startsWith('insert into public.inventory')){state.inventory[p[1]]=p[2];return rows([]);}
        if(sql.startsWith('update public.inventory')){state.inventory[p[1]]=p[0];return rows([]);}
        if(sql.startsWith('update public.game_character set atk=')){
            ['atk','def','agi','daily_meal_count'].forEach((k,i)=>state.character[k]=p[i]);return rows([]);
        }
        if(sql.startsWith('update public.game_character')){
            ['hp','blood','ap','currency','status','death_count'].forEach((k,i)=>state.character[k]=p[i]);return rows([{...state.character}]);
        }
        if(sql.startsWith('insert into public.action_log')){
            if(failLog)throw Error('log failed');
            state.logs.push({requestKey:p[8],detail:JSON.parse(p[7])});return rows([]);
        }
        throw Error(`Unexpected SQL: ${sql}`);
    }};
    return {repo:createCookingRepository({connect:async()=>client},{random}),state:()=>state,calls};
}
test('repository settles mixed batch once, records each attempt and rejects duplicate UUID',async()=>{
    const draws=[0,.9];const f=fixture({random:()=>draws.shift()});
    const r=await f.repo.cookRecipe('u','2',key,2);
    assert.equal(r.apCost,4);assert.equal(r.ap,6);assert.equal(r.successCount,1);assert.equal(r.failureCount,1);
    assert.equal(f.state().inventory[1],8);assert.equal(f.state().inventory[2],2);
    assert.equal(f.state().inventory[3],5);assert.equal(f.state().inventory[4],1);
    assert.equal(f.state().logs[0].detail.attempts.length,2);
    const saved=structuredClone(f.state());
    await assert.rejects(f.repo.cookRecipe('u','2',key,2),e=>e.code==='DUPLICATE_REQUEST');
    assert.deepEqual(f.state(),saved);
    assert.ok(f.calls.findIndex(s=>s.includes('public.recipe where'))<f.calls.findIndex(s=>s.includes('public.item where')));
});
test('AP shortfall and log error roll back entire batch',async()=>{
    for(const options of [{ap:1},{failLog:true}]){
        const f=fixture(options),before=structuredClone(f.state());
        await assert.rejects(f.repo.cookRecipe('u','2',key,2));assert.deepEqual(f.state(),before);
        assert.equal(f.calls.at(-1),'rollback');
    }
});
test('single cooking retains succeeded/output fields; state and battle restrictions',async()=>{
    const f=fixture();const r=await f.repo.cookRecipe('u','2',key);
    assert.equal(r.succeeded,true);assert.equal(r.output.quantity,3);
    for(const options of [{status:'DEAD'},{status:'NEAR_DEATH'},{active:true}])await assert.rejects(fixture(options).repo.cookRecipe('u','2',key));
});
test('NEAR_DEATH meal recovers; fixed +1 at 20%, cap 40 and fifth meal limit',async()=>{
    const f=fixture({status:'NEAR_DEATH',foodCount:4,random:()=>.199});
    const r=await f.repo.eatFood('u','3',key);
    assert.equal(r.blood,10);assert.equal(r.growth.amount,1);assert.equal(r.stats.atk,40);assert.equal(r.dailyMealCount,5);
    assert.equal(f.state().character.status,'ALIVE');
    await assert.rejects(f.repo.eatFood('u','3','second'),e=>e.code==='DAILY_MEAL_LIMIT');
    assert.equal((await fixture({random:()=>.2}).repo.eatFood('u','3',key)).growth,null);
    assert.equal((await fixture({atk:40}).repo.eatFood('u','3',key)).growth,null);
    for(const options of [{status:'DEAD'},{active:true}])await assert.rejects(fixture(options).repo.eatFood('u','3',key));
});
