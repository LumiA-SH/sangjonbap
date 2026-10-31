import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {selectReward,validateRewards,requirePeriod} from '../src/modules/gacha/rules.js';
import {createGachaService} from '../src/modules/gacha/service.js';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';

test('weight sum selection boundary and invalid configurations',()=>{
    const rewards=[{id:'1',weight:2,quantity:1},{id:'2',weight:6,quantity:3}];
    assert.equal(validateRewards(rewards),8);
    for(const [sample,id] of [[0,'1'],[0.249999,'1'],[0.25,'2'],[0.999999,'2']]) assert.equal(selectReward(rewards,()=>sample).id,id);
    for(const rows of [[],[{weight:0,quantity:1}],[{weight:-1,quantity:1}],[{weight:1.5,quantity:1}],[{weight:1,quantity:0}],[{weight:Number.MAX_SAFE_INTEGER,quantity:1},{weight:1,quantity:1}]]) {
        assert.throws(()=>validateRewards(rows),e=>e.code==='GACHA_REWARDS_INVALID');
    }
    assert.throws(()=>selectReward(rewards,()=>1));
});
test('period interior, outside and exact boundary HOLD; input validation and memory fallback',async()=>{
    requirePeriod({boundary:false,outside:false});
    assert.throws(()=>requirePeriod({boundary:true,outside:false}),e=>e.code==='GACHA_PERIOD_POLICY_HOLD');
    assert.throws(()=>requirePeriod({boundary:false,outside:true}),e=>e.code==='GACHA_CLOSED');
    const service=createGachaService({});
    for(const id of ['0','-1','1.1','9223372036854775808']) await assert.rejects(service.draw('1',id,{requestKey:randomUUID()}),e=>e.code==='INVALID_GACHA_ID');
    for(const body of [{},{requestKey:'bad'},{requestKey:randomUUID(),quantity:10}]) await assert.rejects(service.draw('1','1',body),e=>e.code==='INVALID_REQUEST_KEY');
    await assert.rejects(service.getCatalog('1'),e=>e.code==='GACHA_UNAVAILABLE');
});
test('HTTP routes authenticate and use session ownership',async t=>{
    const repo=createMemoryRepository('1'), calls=[];
    repo.getGachaCatalog=async user=>{calls.push(user);return {gachas:[]};};
    repo.drawGacha=async(...args)=>{calls.push(args);return {currency:5};};
    const config={nodeEnv:'development',provider:'dev',userId:'1',loginKey:'dev-test-only-key',origin:'http://localhost:3000'};
    const server=createApp(config,repo).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const base=`http://127.0.0.1:${server.address().port}/api`;
    assert.equal((await fetch(base+'/gacha/catalog')).status,401);
    const login=await fetch(base+'/auth/dev/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:config.loginKey})});
    const headers={Authorization:`Bearer ${(await login.json()).data.token}`,'Content-Type':'application/json'};
    assert.equal((await fetch(base+'/gacha/catalog',{headers})).status,200);
    const key=randomUUID();const response=await fetch(base+'/gacha/2/draw',{method:'POST',headers,body:JSON.stringify({requestKey:key.toUpperCase()})});
    assert.equal(response.status,200);assert.equal((await response.json()).data.currency,5);assert.deepEqual(calls,['1',['1','2',key]]);
});
