import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAdminDeleteRepository} from '../src/modules/admin/delete-repository.js';
import {createAdminSettingsRepository,balanceRequirements} from '../src/modules/admin/settings-repository.js';
import {createAdminCharacterOperations,validateCharacterOperation} from '../src/modules/admin/character-operations.js';
import {validateInvestigationConfig} from '../src/modules/admin/investigation-operations.js';
import {createCharacterCareService} from '../src/modules/character/care-service.js';

// Transaction state model; real PostgreSQL constraint/locking tests remain separate.
function deletion({admin=true,reference=false,history=false,snapshotReference=false,failLog=false}={}) {
    let state={parent:true,children:3,logs:[]},saved;const calls=[];
    const rows=r=>({rows:r,rowCount:r.length});
    const c={release(){},async query(sql,p=[]){calls.push(sql);
        if(sql==='begin'){saved=structuredClone(state);return rows([]);}if(sql==='rollback'){state=saved;return rows([]);}if(sql==='commit')return rows([]);
        if(sql.startsWith('select id from public.area'))return rows([]);
        if(sql.startsWith('select id from public.auth_user'))return rows(admin?[{id:'1'}]:[]);
        if(sql.startsWith('select id from public.action_log'))return rows([]);
        if(sql.startsWith('select * from public.'))return rows([{id:'2',name:'master'}]);
        if(sql.startsWith('select 1 from public.action_log'))return rows(history?[{}]:[]);
        if(sql.includes('from pg_constraint'))return rows(reference?[{schema_name:'public',table_name:'inventory',column_name:'item_id',key_count:1}]:[]);
        if(sql.startsWith('select 1 from "public"'))return rows([{}]);
        if(sql.startsWith('select 1 from public.battle'))return rows(snapshotReference?[{}]:[]);
        if(sql.startsWith('delete from public.monster ')||sql.startsWith('delete from public.item ')){state.parent=false;return rows([]);}
        if(sql.startsWith('delete from public.')){state.children--;return rows([]);}
        if(sql.startsWith('insert into public.action_log')){if(failLog)throw Error('audit failed');state.logs.push(JSON.parse(p[7]));return rows([]);}
        throw Error(sql);
    }};
    return {repo:createAdminDeleteRepository({connect:async()=>c}),state:()=>state,calls};
}
test('unreferenced deletion keeps audit; referenced/history/snapshot objects are not deleted',async()=>{
    const f=deletion();await f.repo.deleteAdminRecord('1','monsters','2',{requestKey:randomUUID()});assert.equal(f.state().parent,false);assert.equal(f.state().children,0);assert.equal(f.state().logs[0].before.name,'master');
    for(const options of [{reference:true},{history:true},{snapshotReference:true}]){
        const f=deletion(options);await assert.rejects(f.repo.deleteAdminRecord('1','items','2',{requestKey:randomUUID()}),e=>e.code==='ADMIN_RECORD_REFERENCED');assert.equal(f.state().parent,true);
    }
});
test('deletion audit failure restores parent and owned children; revoked administrator cannot delete',async()=>{
    const f=deletion({failLog:true});await assert.rejects(f.repo.deleteAdminRecord('1','monsters','2',{requestKey:randomUUID()}),/audit failed/);
    assert.deepEqual(f.state(),{parent:true,children:3,logs:[]});assert.equal(f.calls.at(-1),'rollback');
    const denied=deletion({admin:false});await assert.rejects(denied.repo.deleteAdminRecord('1','items','2',{requestKey:randomUUID()}),e=>e.code==='ADMIN_REQUIRED');assert.equal(denied.state().parent,true);
});
test('balance save uses numeric values, preserves other keys and rolls back all changes on log failure',async()=>{
    for(const failLog of [false,true]){
        let state=Object.fromEntries(Object.keys(balanceRequirements).map(k=>[k,1])),saved;
        const c={release(){},async query(sql,p=[]){
            const rows=r=>({rows:r,rowCount:r.length});
            if(sql==='begin'){saved={...state};return rows([]);}if(sql==='rollback'){state=saved;return rows([]);}if(sql==='commit')return rows([]);
            if(sql.startsWith('select id from public.auth_user'))return rows([{}]);if(sql.startsWith('select id from public.action_log'))return rows([]);
            if(sql.startsWith('select config_key,config_value'))return rows(p[0].map(k=>({config_key:k,config_value:state[k]})));
            if(sql.startsWith('select config_key from'))return rows([]);
            if(sql.startsWith('update public.system_config')){state[p[0]]=JSON.parse(p[1]);return rows([]);}
            if(sql.startsWith('insert into public.action_log')){if(failLog)throw Error('audit failed');return rows([]);}throw Error(sql);
        }};
        const repo=createAdminSettingsRepository({connect:async()=>c});const job=repo.saveAdminBalanceSettings('1',{requestKey:randomUUID(),settings:{heal_blood_cost:7,heal_hp_recovery:12}});
        if(failLog){await assert.rejects(job,/audit failed/);assert.equal(state.heal_blood_cost,1);}else{
            await job;assert.equal(state.heal_blood_cost,7);assert.equal(state.heal_hp_recovery,12);
            const care=createCharacterCareService({performCharacterCare:async(u,t,k,a,plan)=>plan({id:'1',hp:50,blood:20,status:'ALIVE'},{id:'2',hp:10,status:'ALIVE'},state)});
            const plan=await care.heal('1','2',{requestKey:randomUUID()});assert.equal(plan.cost,7);assert.equal(plan.targetChanges.hp,12);
        }
        assert.equal(state.training_growth,1);
    }
});
test('character operations and investigation validation prohibit history tampering and invalid bounds',()=>{
    for(const patch of [{status:'ALIVE'},{death_count:0},{hp:-1},{atk:1.5}])assert.throws(()=>validateCharacterOperation({...patch,requestKey:randomUUID()}));
    assert.doesNotThrow(()=>validateCharacterOperation({itemId:'1',quantity:0,requestKey:randomUUID()},true));
    const body={requestKey:randomUUID(),result_grade:'NORMAL',result_text:'보상',weight:1,is_unique:true,is_active:true,investigation_rate_value:25,clue_id:null,rewards:[{item_id:'1',quantity:2,probability:30}]};
    validateInvestigationConfig(body);
    for(const patch of [{weight:0},{investigation_rate_value:101},{rewards:[...body.rewards,...body.rewards]},{discovery:{character_id:'3'}},{rewards:[{recipe_id:'2',quantity:2,probability:100}]}])assert.throws(()=>validateInvestigationConfig({...body,...patch}));
});

test('character resource edits use shared death transition and rollback on audit error',async()=>{
    for(const failLog of [false,true]){
        let character={id:'2',hp:10,max_hp:100,blood:20,max_blood:100,ap:3,max_ap:10,currency:3,status:'ALIVE',death_count:0},saved;
        const rows=r=>({rows:r,rowCount:r.length});
        const c={release(){},async query(raw,p=[]){const sql=raw.replace(/\s+/g,' ').trim();
            if(sql==='begin'){saved={...character};return rows([]);}if(sql==='rollback'){character=saved;return rows([]);}if(sql==='commit')return rows([]);
            if(sql.startsWith('select id from public.auth_user'))return rows([{}]);if(sql.startsWith('select id from public.action_log')||sql.startsWith('select id from public.battle'))return rows([]);
            if(sql.startsWith('select * from public.game_character'))return rows([{...character}]);if(sql.startsWith('select i.item_id'))return rows([]);
            if(sql.startsWith('update public.game_character')){['hp','blood','ap','currency','status','death_count'].forEach((k,i)=>character[k]=p[i]);return rows([{...character}]);}
            if(sql.startsWith('insert into public.action_log')){if(failLog&&p[3]==='CHARACTER_UPDATE')throw Error('audit failed');return rows([]);}throw Error(sql);
        }};
        const repo=createAdminCharacterOperations({connect:async()=>c}),job=repo.saveAdminCharacter('1','2',{hp:0,requestKey:randomUUID()});
        if(failLog){await assert.rejects(job,/audit failed/);assert.equal(character.hp,10);assert.equal(character.death_count,0);}else{await job;assert.equal(character.status,'DEAD');assert.equal(character.death_count,1);}
    }
});
