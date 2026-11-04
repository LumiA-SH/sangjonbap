import {AppError,ok} from '../../shared/http.js';
import {validId} from './service.js';
import {validateMasterInput} from './master-service.js';
import {validateRoleInput} from './role-repository.js';
import {recordsCursor,recordsPage} from '../records/routes.js';

function id(value) {if (!validId(value)) throw new AppError(400,'INVALID_ID','올바른 ID가 필요합니다.');}
function cursor(req,allowed=['after']) {
    const after=req.query.after??'0';
    if (Object.keys(req.query).some(k=>!allowed.includes(k)) || (after!=='0'&&!validId(after))) throw new AppError(400,'INVALID_CURSOR','올바른 검색 조건이 필요합니다.');
    return after;
}
// Called only after existing authentication + ADMIN middleware.
export function mountExtendedAdminRoutes(router,repo) {
    router.get('/areas/:areaId/results',async(req,res)=>{id(req.params.areaId);ok(res,await repo.getAdminInvestigation(req.params.areaId));});
    for(const method of ['post','patch'])router[method](`/areas/:areaId/results${method==='patch'?'/:id':''}`,async(req,res)=>{
        id(req.params.areaId);if(req.params.id)id(req.params.id);
        ok(res,{record:await repo.saveAdminInvestigation(req.auth.user.id,req.params.areaId,req.params.id||null,req.body)},method==='post'?201:200);
    });
    router.get('/characters',async(req,res)=>{
        const after=cursor(req,['q','after']),q=req.query.q??'';
        if(typeof q!=='string'||q.length>100)throw new AppError(400,'INVALID_QUERY','검색어는 100자 이내입니다.');
        const records=await repo.searchAdminCharacters(q,after);ok(res,{records,nextAfter:records.length===50?records.at(-1).id:null});
    });
    router.get('/characters/:id',async(req,res)=>{id(req.params.id);ok(res,await repo.getAdminCharacter(req.params.id));});
    router.patch('/characters/:id',async(req,res)=>{id(req.params.id);ok(res,await repo.saveAdminCharacter(req.auth.user.id,req.params.id,req.body));});
    router.patch('/characters/:id/inventory',async(req,res)=>{id(req.params.id);ok(res,await repo.saveAdminCharacter(req.auth.user.id,req.params.id,req.body,true));});
    for(const kind of ['items','monsters'])router.delete(`/${kind}/:id`,async(req,res)=>{
        id(req.params.id);ok(res,await repo.deleteAdminRecord(req.auth.user.id,kind,req.params.id,req.body));
    });
    router.get('/balance',async(req,res)=>ok(res,{settings:await repo.getAdminBalanceSettings()}));
    router.patch('/balance',async(req,res)=>ok(res,{settings:await repo.saveAdminBalanceSettings(req.auth.user.id,req.body)}));
    router.get('/action-logs',async(req,res)=>{
        const before=recordsCursor(req.query);
        if(!repo.getAdminActionRecords)throw new AppError(501,'RECORDS_UNAVAILABLE','기록 조회는 Supabase 모드에서 지원합니다.');
        ok(res,recordsPage(await repo.getAdminActionRecords(req.auth.user.id,before)));
    });
    router.get('/battle-areas',async(req,res)=>ok(res,{records:await repo.listAdminBattleAreas()}));
    router.get('/users/:id/verified-account',async(req,res)=>{id(req.params.id);ok(res,{record:await repo.getAdminVerifiedAccount(req.params.id)});});
    router.get('/monsters',async(req,res)=>ok(res,{records:await repo.listAdminMonsters()}));
    router.get('/monsters/:id',async(req,res)=>{id(req.params.id);ok(res,{record:await repo.getAdminMonster(req.params.id)});});
    for(const method of ['post','patch'])router[method](`/monsters${method==='patch'?'/:id':''}`,async(req,res)=>{
        const target=req.params.id||null;if(target)id(target);
        ok(res,{record:await repo.saveAdminMonster(req.auth.user.id,target,req.body)},target?200:201);
    });
    router.get('/battle-abilities',async(req,res)=>ok(res,{settings:await repo.getAdminAbilitySettings()}));
    router.patch('/battle-abilities',async(req,res)=>ok(res,{settings:await repo.saveAdminAbilitySettings(req.auth.user.id,req.body)}));
    router.post('/users/:id/character',async(req,res)=>{
        id(req.params.id);ok(res,{character:await repo.registerAdminCharacter(req.auth.user.id,req.params.id,req.body)},201);
    });
    for (const kind of ['foods','recipes','gachas','areas']) {
        router.get(`/${kind}`,async(req,res)=>{
            const records=await repo.listAdminMasters(kind,cursor(req));
            ok(res,{records,nextAfter:records.length===100?records.at(-1).id:null});
        });
        router.get(`/${kind}/:id`,async(req,res)=>{id(req.params.id);ok(res,{record:await repo.getAdminMaster(kind,req.params.id)});});
        for (const method of ['post','patch']) router[method](`/${kind}${method==='patch'?'/:id':''}`,async(req,res)=>{
            const target=req.params.id||null;if(target)id(target);
            const input=validateMasterInput(kind,req.body,!target);
            ok(res,{record:await repo.saveAdminMaster(req.auth.user.id,kind,target,input.patch,input.requestKey)},target?200:201);
        });
    }
    router.get('/users',async(req,res)=>{
        const after=cursor(req,['q','after']),q=req.query.q??'';
        if (typeof q!=='string'||q.length>100) throw new AppError(400,'INVALID_QUERY','검색어는 100자 이내입니다.');
        const records=await repo.searchAdminUsers(q,after);
        ok(res,{records,nextAfter:records.length===100?records.at(-1).id:null});
    });
    router.patch('/users/:id/role',async(req,res)=>{
        id(req.params.id);
        const input=validateRoleInput(req.body);
        ok(res,{record:await repo.changeAdminRole(req.auth.user.id,req.params.id,input.role,input.requestKey)});
    });
}
