import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadConfig} from '../src/config/env.js';
import {createPool} from '../src/db/pool.js';
import {createAdminRepository} from '../src/modules/admin/repository.js';
import {requireAdminRow} from '../src/modules/admin/transaction.js';
import {validId} from '../src/modules/admin/service.js';
import {writeActionLog} from '../src/shared/game.js';

const marker='sangjonbap:dev:admin-masters:v1';
export function requireDevMasterEnvironment(config) {
    if (config.nodeEnv!=='development'||config.provider!=='dev'||config.mode!=='supabase') throw new Error('development / DEV 인증 / Supabase에서만 실행할 수 있습니다.');
}
// Caller owns outer transaction. Reuse normal admin writes with sequential savepoints.
function nestedPool(c) {
    return {query:(...args)=>c.query(...args),async connect(){return {
        release(){},query(sql,params){
            if(sql==='begin')return c.query('savepoint dev_master_write');
            if(sql==='commit')return c.query('release savepoint dev_master_write');
            if(sql==='rollback')return c.query('rollback to savepoint dev_master_write');
            return c.query(sql,params);
        }
    };}};
}
export async function manageDevAdminMasters(c,config,adminId,{deactivate=false}={}) {
    requireDevMasterEnvironment(config);
    if(!validId(adminId))throw new Error('기존 ADMIN 계정 ID가 필요합니다.');
    await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[marker]);
    await requireAdminRow(c,adminId);
    const repo=createAdminRepository(nestedPool(c));
    const existing=(await c.query("select detail from public.action_log where action_type='DEV_MASTER_CREATE' and detail->>'marker'=$1 order by id limit 1",[marker])).rows[0];
    if(existing) {
        const ids=existing.detail.ids;
        if(deactivate) {
            await repo.saveAdminMaster(adminId,'recipes',ids.recipe,{is_active:false},randomUUID());
            await repo.saveAdminMaster(adminId,'gachas',ids.gacha,{is_active:false},randomUUID());
            for(const id of ids.items)await repo.saveAdminRecord(adminId,'items',id,{is_active:false},randomUUID());
            await writeActionLog(c,{adminUserId:adminId,category:'ADMIN',actionType:'DEV_MASTER_DEACTIVATE',description:'DEV 마스터 비활성화 (기록 보존)',detail:{marker,ids},requestKey:randomUUID()});
        }
        return {mode:deactivate?'deactivated':'existing',ids};
    }
    if(deactivate)return {mode:'absent'};
    const names=['[DEV ADMIN v1] 재료','[DEV ADMIN v1] 완성 음식','[DEV ADMIN v1] 실패 음식'];
    if((await c.query('select id from public.item where name=any($1::text[])',[names])).rowCount)throw new Error('기존 이름과 충돌합니다. 덮어쓰지 않습니다.');
    const items=[];
    for(const [i,name] of names.entries())items.push((await repo.saveAdminRecord(adminId,'items',null,{name,category:i===0?'MATERIAL':'FOOD',description:marker},randomUUID())).id);
    for(const id of items.slice(1))await repo.saveAdminMaster(adminId,'foods',null,{item_id:id,blood_recovery:0,stat_growth_enabled:false,stat_growth_rate:0,stat_growth_target:null,stat_growth_value:0,rp_effect_text:'DEV 테스트 전용'},randomUUID());
    const recipe=await repo.saveAdminMaster(adminId,'recipes',null,{name:'[DEV ADMIN v1] 레시피',learn_cost:0,success_rate:50,result_item_id:items[1],failure_item_id:items[2],is_active:true,ingredients:[{item_id:items[0],quantity:2}]},randomUUID());
    const rp=await repo.saveAdminRecord(adminId,'items',null,{name:'[DEV ADMIN v1] RP 소품',category:'MATERIAL',description:marker,transferable:true,usable:false,battle_usable:false,use_target:'NONE',effect_type:null,effect_value:null},randomUUID());
    items.push(rp.id);
    const gacha=await repo.saveAdminMaster(adminId,'gachas',null,{name:'[DEV ADMIN v1] 가챠',price:1,is_active:true,start_at:null,end_at:null,rewards:[{item_id:rp.id,quantity:1,max_stock:10,remaining_stock:10}]},randomUUID());
    const ids={items,recipe:recipe.id,gacha:gacha.id};
    await writeActionLog(c,{adminUserId:adminId,category:'ADMIN',actionType:'DEV_MASTER_CREATE',description:'DEV 마스터 생성',detail:{marker,ids},requestKey:randomUUID()});
    return {mode:'created',ids};
}
async function main() {
    const args=process.argv.slice(2);
    if(args[0]!=='--admin-id'||!validId(args[1])||args.length>3||(args[2]&&args[2]!=='--deactivate'))throw new Error('사용법: node server/scripts/dev-admin-masters.js --admin-id ID [--deactivate]');
    const config=loadConfig();requireDevMasterEnvironment(config);
    const pool=createPool(config),c=await pool.connect();
    try {
        await c.query('begin');
        const result=await manageDevAdminMasters(c,config,args[1],{deactivate:args.includes('--deactivate')});
        await c.query('commit');console.log(JSON.stringify(result,null,2));
    } catch(e){await c.query('rollback');throw e;}finally{c.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
