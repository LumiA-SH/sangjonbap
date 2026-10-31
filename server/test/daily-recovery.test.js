import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryDecayReason} from '../src/modules/daily/recovery.js';
import {millisecondsUntilKstMidnight,startDailyScheduler} from '../src/modules/daily/scheduler.js';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';
import {AppError} from '../src/shared/http.js';
test('KST timer boundaries independent of process TZ',()=>{
    assert.equal(millisecondsUntilKstMidnight(Date.parse('2026-10-12T14:59:59.000Z')),1000);
    assert.equal(millisecondsUntilKstMidnight(Date.parse('2026-10-12T15:00:00.000Z')),86400000);
});
test('recorded prior reset allows revived survivor without inferring missing history',()=>{
    const c={created_at:'2026-10-01T00:00:00Z',status:'ALIVE',hp:100,death_count:1,revive_count:1};
    assert.equal(recoveryDecayReason(c,'2026-10-12T15:00:00Z'),'LIFECYCLE_HISTORY_INCOMPLETE');
    assert.equal(recoveryDecayReason(c,'2026-10-12T15:00:00Z',c),null);
    assert.equal(recoveryDecayReason(c,'2026-10-12T15:00:00Z',{...c,death_count:0}),'LIFECYCLE_HISTORY_INCOMPLETE');
});
test('scheduler invokes recovery at startup, reports HOLD, and awaits stop',async()=>{
    const holds=[];let calls=0;
    const scheduler=startDailyScheduler(async()=>{calls++;return {hold:'DAILY_RESET_START_HOLD'};},{onHold:c=>holds.push(c)});
    await scheduler.stop();assert.equal(calls,1);assert.deepEqual(holds,['DAILY_RESET_START_HOLD']);
});
test('gameplay gate authenticates before recovery and propagates recovery HOLD',async t=>{
    const repo=createMemoryRepository('1');let calls=0;
    repo.recoverDailyReset=async()=>{calls++;throw new AppError(503,'DAILY_RESET_ACTIVITY_HOLD','운영자 확인 필요');};
    const config={nodeEnv:'development',provider:'dev',userId:'1',loginKey:'dev-test-only-key',origin:'http://localhost:3000'};
    const server=createApp(config,repo).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    t.after(()=>new Promise(r=>server.close(r)));
    const base=`http://127.0.0.1:${server.address().port}/api`;
    assert.equal((await fetch(base+'/characters/me')).status,401);assert.equal(calls,0);
    const login=await fetch(base+'/auth/dev/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:config.loginKey})});
    const token=(await login.json()).data.token;
    const result=await fetch(base+'/characters/me',{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(result.status,503);assert.equal(calls,1);
    assert.equal((await fetch(base+'/health')).status,200);
});
