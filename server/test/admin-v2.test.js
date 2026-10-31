import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateMasterInput,validateMasterState} from '../src/modules/admin/master-service.js';
import {validateRoleInput} from '../src/modules/admin/role-repository.js';
import {parseBootstrapArgs,confirmFirstAdmin} from '../scripts/bootstrap-admin.js';
import {requireDevMasterEnvironment} from '../scripts/dev-admin-masters.js';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';

test('admin master validation matches food constraints and percentage units',()=>{
    const key=randomUUID();
    for(const rate of [0,50.5,100])assert.equal(validateMasterInput('foods',{item_id:'1',stat_growth_rate:rate,requestKey:key},true).patch.stat_growth_rate,rate);
    for(const patch of [{stat_growth_rate:101},{stat_growth_rate:50.555},{stat_growth_rate:'50'},{blood_recovery:-1},{stat_growth_target:'RANDOM'},{stat_growth_value:1.5},{hack:1}])assert.throws(()=>validateMasterInput('foods',{...patch,requestKey:key},false));
    assert.throws(()=>validateMasterInput('foods',{item_id:'2',requestKey:key},false));
    assert.throws(()=>validateMasterState('foods',{stat_growth_enabled:false,stat_growth_target:'ATK',stat_growth_value:1}));
    assert.doesNotThrow(()=>validateMasterState('foods',{stat_growth_enabled:false,stat_growth_target:null,stat_growth_value:0}));
});
test('nested ingredient/reward validation and dates',()=>{
    const key=randomUUID(),row={item_id:'1',quantity:1};
    for(const ingredients of [[],[row,row],[{...row,quantity:0}],[{...row,extra:'x'}]])assert.throws(()=>validateMasterInput('recipes',{ingredients,requestKey:key},false));
    for(const rewards of [[],[{...row,weight:0}],[{...row,weight:1.5}]])assert.throws(()=>validateMasterInput('gachas',{rewards,requestKey:key},false));
    assert.equal(validateMasterInput('gachas',{rewards:[{...row,weight:2}],start_at:null,requestKey:key},false).patch.rewards[0].weight,2);
    assert.throws(()=>validateMasterInput('gachas',{start_at:'2026-10-11T12:00',requestKey:key},false));
    assert.throws(()=>validateMasterInput('recipes',{result_quantity:1,requestKey:key},false));
    assert.throws(()=>validateMasterState('recipes',{result_quantity:4,success_rate:50,failure_item_id:null}));
});
test('bootstrap requires exact explicit confirmation and validates CLI identifiers',async()=>{
    assert.throws(()=>parseBootstrapArgs(['--user-id','1']));
    const target=parseBootstrapArgs(['--user-id','1','--account-id','external','--instance','example.invalid']);
    let changed=0,printed=false;
    const repo={previewFirstAdmin:async()=>target,bootstrapFirstAdmin:async()=>{changed++;return {id:'1'};}};
    await assert.rejects(confirmFirstAdmin(repo,target,{print:()=>{printed=true;},ask:async()=> 'yes'}));
    assert.equal(changed,0);assert.equal(printed,true);
    await confirmFirstAdmin(repo,target,{print:()=>{},ask:async()=> 'PROMOTE 1 external example.invalid'});
    assert.equal(changed,1);
    assert.throws(()=>validateRoleInput({role:'OWNER',requestKey:randomUUID()}));
    assert.throws(()=>requireDevMasterEnvironment({nodeEnv:'production',provider:'dev',mode:'supabase'}));
});
test('all phase 2 routes authenticate and require ADMIN; roles revoked immediately',async()=>{
    let role='USER';const repo=createMemoryRepository('1');
    repo.getUser=async()=>({id:'1',is_active:true,role});
    repo.listAdminRecords=async()=>[];repo.getAdminRecord=async()=>({});repo.saveAdminRecord=async()=>({});
    repo.listAdminMasters=async()=>[];repo.getAdminMaster=async()=>({id:'1'});repo.saveAdminMaster=async()=>({id:'1'});
    repo.searchAdminUsers=async()=>[];repo.changeAdminRole=async()=>({id:'2',role:'ADMIN'});
    const config={nodeEnv:'development',provider:'dev',userId:'1',loginKey:'dev-test-only-key',origin:'http://localhost:3000'};
    const server=createApp(config,repo).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}/api`;
    try {
        const login=await fetch(`${base}/auth/dev/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:config.origin},body:JSON.stringify({key:config.loginKey})});
        const payload=await login.json();
        const token=payload.data?.token;
        assert.ok(token);
        const paths=['foods','recipes','gachas','users'];
        for(const path of paths){
            assert.equal((await fetch(`${base}/admin/${path}`)).status,401);
            assert.equal((await fetch(`${base}/admin/${path}`,{headers:{Authorization:`Bearer ${token}`}})).status,403);
        }
        role='ADMIN';
        for(const path of paths)assert.equal((await fetch(`${base}/admin/${path}`,{headers:{Authorization:`Bearer ${token}`}})).status,200);
        role='USER';
        assert.equal((await fetch(`${base}/admin/users/2/role`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({role:'ADMIN',requestKey:randomUUID()})})).status,403);
    }finally{await new Promise(r=>server.close(r));}
});
