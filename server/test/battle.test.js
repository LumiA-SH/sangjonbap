import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {attackDamage,monsterDamage,escapeChance,resolveTurn,chooseMonsterAction} from '../src/modules/battle/engine.js';
import {validateBattleCommand} from '../src/modules/battle/routes.js';
import {validateMonster} from '../src/modules/admin/battle-repository.js';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';
import {startBattleExpiry} from '../src/modules/battle/scheduler.js';

const pc={hp:100,max_hp:100,blood:100,max_blood:100,ap:10,atk:20,def:10,agi:10,status:'ALIVE',has_ability:true,ability_grade:'B'};
const monster={hp:100,atk:20,def:10,agi:10};
const declaration={action_type:'ATTACK',multiplier:1};
const turn=(options={},random=()=>0)=>resolveTurn({character:pc,monster,declaration,action:'ATTACK',...options},random);
const reject=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('normal/ability damage floors, costs and independent rolls',()=>{
    assert.equal(attackDamage(20,10,1),21);assert.equal(monsterDamage(20,10,1),11);
    const r=turn();assert.equal(r.pcDamage,21);assert.equal(r.enemyDamage,11);assert.equal(r.blood,100);assert.equal(r.ap,10);
    const a=turn({action:'ABILITY',ability:{multiplier:1.8,ap_cost:2}});
    assert.equal(a.pcDamage,37);assert.equal(a.ap,8);assert.equal(a.blood,100);
    reject(()=>turn({action:'ABILITY',character:{...pc,has_ability:false}}),'ABILITY_UNAVAILABLE');
    reject(()=>turn({action:'ABILITY',character:{...pc,ap:1},ability:{multiplier:1.8,ap_cost:2}}),'NOT_ENOUGH_AP');
});
test('defense can be guaranteed and counters without blood cost; failure takes damage',()=>{
    const r=turn({action:'DEFEND',character:{...pc,def:30}});
    assert.equal(r.defended,true);assert.equal(r.enemyDamage,0);assert.equal(r.pcDamage,8);assert.equal(r.blood,100);
    assert.equal(turn({action:'DEFEND'}).enemyDamage,11);
    const rolls=[0,0.999,0];
    assert.equal(turn({action:'DEFEND',character:{...pc,def:29}},()=>rolls.shift()).defended,true);
});
test('special damage multiplies already floored normal damage',()=>{
    assert.equal(turn({declaration:{action_type:'SPECIAL_ATTACK',multiplier:1.5}}).enemyDamage,16);
    assert.equal(monsterDamage(1,100,1,0.4),1);
});
test('kill still receives declared damage; simultaneous death is victory',()=>{
    const r=turn({character:{...pc,hp:1},monster:{...monster,hp:1}});
    assert.equal(r.status,'VICTORY');assert.equal(r.hp,0);assert.equal(r.monsterHp,0);assert.equal(r.enemyDamage,11);
});
test('positive blood permits free attacks; zero blood remains blocked',()=>{
    const r=turn({character:{...pc,blood:5}});assert.equal(r.status,'ACTIVE');assert.equal(r.blood,5);assert.equal(r.hp,89);
    assert.equal(turn({character:{...pc,blood:5},monster:{...monster,hp:1}}).status,'VICTORY');
    for(const blood of [1,2,3,4])assert.equal(turn({character:{...pc,blood}}).blood,blood);
    reject(()=>turn({character:{...pc,blood:0}}),'BATTLE_CHARACTER_UNAVAILABLE');
});
test('blood pack applies before attack, uses configured amount and cap',()=>{
    const item={is_active:true,usable:true,battle_usable:true,use_target:'SELF',effect_type:'BLOOD_PACK',effect_value:40};
    const r=turn({action:'ITEM',character:{...pc,blood:5},item});assert.equal(r.blood,45);assert.equal(r.hp,89);
    assert.equal(turn({action:'ITEM',item}).blood,100);
    reject(()=>turn({action:'ITEM',item:{...item,battle_usable:false}}),'BATTLE_ITEM_UNAVAILABLE');
});
test('flee chance clamps, success avoids damage, failure takes declared attack',()=>{
    assert.equal(escapeChance(100,0),85);assert.equal(escapeChance(0,100),15);
    assert.equal(turn({action:'FLEE'}).status,'FLED');assert.equal(turn({action:'FLEE'}).hp,100);
    assert.equal(turn({action:'FLEE'},()=>0.99).status,'ACTIVE');
});
test('monster flee: block succeeds/fails, last attack kill wins, both flee without RNG',()=>{
    const d={action_type:'FLEE'};
    assert.equal(turn({declaration:d,action:'BLOCK_FLEE'}).status,'ACTIVE');
    assert.equal(turn({declaration:d,action:'BLOCK_FLEE'},()=>0.99).fledActor,'MONSTER');
    assert.equal(turn({declaration:d}).status,'FLED');
    assert.equal(turn({declaration:d,monster:{...monster,hp:1}}).status,'VICTORY');
    assert.equal(turn({declaration:d,action:'FLEE'},()=>{throw Error('unused');}).fledActor,'PC');
    reject(()=>turn({declaration:d,action:'DEFEND'}),'INVALID_BATTLE_ACTION');
});
test('monster action percent boundaries and condition HOLD',()=>{
    const actions=[{action_type:'ATTACK',probability:25},{action_type:'FLEE',probability:75}];
    assert.equal(chooseMonsterAction(actions,()=>0.24999).action_type,'ATTACK');
    assert.equal(chooseMonsterAction(actions,()=>0.25).action_type,'FLEE');
    reject(()=>chooseMonsterAction([{...actions[0],probability:99}]),'BATTLE_CONFIG_INVALID');
    reject(()=>chooseMonsterAction([{...actions[0],condition_type:'UNKNOWN'}]),'MONSTER_CONDITION_HOLD');
});
test('command input never accepts client damage/state or invalid IDs',()=>{
    const body={requestKey:randomUUID(),turnNo:1,action:'ATTACK'};
    assert.equal(validateBattleCommand(body).action,'ATTACK');
    for(const b of [{...body,damage:100},{...body,turnNo:0},{...body,action:'ITEM',itemId:'-1'},{...body,requestKey:'bad'}])reject(()=>validateBattleCommand(b),'INVALID_BATTLE_COMMAND');
});
test('admin monster validator rejects duplicate rewards, malformed quantities and inactive sum',()=>{
    const body={requestKey:randomUUID(),name:'test',is_active:true,max_hp:10,atk:10,def:10,agi:10,areas:[],drops:[],
        actions:[{name:'attack',action_type:'ATTACK',probability:100,multiplier:1,is_active:true,sort_order:0}]};
    validateMonster(body);
    reject(()=>validateMonster({...body,actions:[null]}),'INVALID_ADMIN_INPUT');
    reject(()=>validateMonster({...body,actions:[{...body.actions[0],probability:33.333}]}),'INVALID_ADMIN_INPUT');
    reject(()=>validateMonster({...body,drops:[{item_id:'1',drop_rate:100,min_quantity:0,max_quantity:1,is_ingredient:false}]}),'INVALID_ADMIN_INPUT');
});

test('battle HTTP requires session, binds actor and rejects forged command fields',async t=>{
    const repo=createMemoryRepository('1'),calls=[];
    repo.getBattle=async(...args)=>{calls.push(args);return {battle:null};};
    repo.commandBattle=async(...args)=>{calls.push(args);return {done:true};};
    const config={nodeEnv:'development',provider:'dev',userId:'1',loginKey:'dev-test-only-key',origin:'http://localhost:3000'};
    const server=createApp(config,repo).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
    const base=`http://127.0.0.1:${server.address().port}/api`;
    assert.equal((await fetch(base+'/battles/current')).status,401);
    const login=await fetch(base+'/auth/dev/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:config.loginKey})});
    const headers={Authorization:`Bearer ${(await login.json()).data.token}`,'Content-Type':'application/json'};
    assert.equal((await fetch(base+'/battles/current',{headers})).status,200);assert.deepEqual(calls.at(-1),['1']);
    const body={requestKey:randomUUID(),turnNo:1,action:'ATTACK'};
    assert.equal((await fetch(base+'/battles/2/commands',{method:'POST',headers,body:JSON.stringify(body)})).status,200);
    assert.deepEqual(calls.at(-1),['1','2',body]);
    assert.equal((await fetch(base+'/battles/2/commands',{method:'POST',headers,body:JSON.stringify({...body,characterId:'999'})})).status,400);
    assert.equal((await fetch(base+'/battles/0',{headers})).status,400);
});

test('expiry worker drains batches, stops cleanly and reports failures',async()=>{
    let count=0;
    const worker=startBattleExpiry(async()=>++count===1?100:0,{intervalMs:100000});
    await new Promise(r=>setImmediate(r));await worker.stop();assert.equal(count,2);
    let error;
    const failing=startBattleExpiry(async()=>{throw Error('test');},{onError:e=>{error=e;},intervalMs:100000});
    await failing.stop();assert.equal(error.message,'test');
});
