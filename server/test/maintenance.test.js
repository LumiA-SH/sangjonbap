import test from 'node:test';
import assert from 'node:assert/strict';
import {createMaintenanceApp} from '../src/modules/maintenance/app.js';
import {createBattleRepository} from '../src/modules/battle/repository.js';
import {AppError} from '../src/shared/http.js';
const secret='test-only-'.repeat(8);
async function fixture(t,repo,executionReady=false){
    const server=createMaintenanceApp(repo,{secret,executionReady}).listen(0,'127.0.0.1');
    await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
    return opts=>fetch(`http://127.0.0.1:${server.address().port}/maintenance`,{method:'POST',...opts});
}
test('maintenance fails closed: auth, browser, method and unresolved concurrency',async t=>{
    let calls=0;const repo={recoverDailyReset:async()=>{calls++;},expireBattles:async()=>{calls++;}};
    const request=await fixture(t,repo);
    assert.equal((await request()).status,401);
    const headers={'x-maintenance-secret':secret};
    assert.equal((await request({headers:{...headers,Origin:'https://survivalbob.site'}})).status,403);
    assert.equal((await request({headers,method:'GET'})).status,404);
    assert.equal((await request({headers})).status,503);assert.equal(calls,0);
});
test('maintenance preserves start HOLD and activity HOLD; next invocation can retry',async t=>{
    let mode='start',expired=0;
    const request=await fixture(t,{recoverDailyReset:async()=>{
        if(mode==='start')return {hold:'DAILY_RESET_START_HOLD'};
        if(mode==='activity')throw new AppError(503,'DAILY_RESET_ACTIVITY_HOLD','operator required');
        return {completed:[]};
    },expireBattles:async options=>{assert.equal(options.limit,10);expired++;return 0;}},true);
    const headers={'x-maintenance-secret':secret};
    assert.equal((await (await request({headers})).json()).data.hold,'DAILY_RESET_START_HOLD');assert.equal(expired,0);
    mode='activity';assert.equal((await request({headers})).status,503);assert.equal(expired,0);
    mode='ready';assert.equal((await request({headers})).status,200);assert.equal(expired,1);
});
test('battle expiry keeps default 100 and parameterizes bounded batch size',async()=>{
    const calls=[];const repo=createBattleRepository({query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}});
    assert.equal(await repo.expireBattles(),0);assert.deepEqual(calls[0].args,[100]);
    await repo.expireBattles({limit:10});assert.deepEqual(calls[1].args,[10]);assert.match(calls[1].sql,/limit \$1/);
    for(const limit of [0,101,1.5,'10'])await assert.rejects(repo.expireBattles({limit}),{code:'INVALID_EXPIRY_LIMIT'});
    assert.equal(calls.length,2);
});
