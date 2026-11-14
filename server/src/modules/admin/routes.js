import {Router} from 'express';
import {AppError,ok} from '../../shared/http.js';
import {requireAdmin} from '../../shared/admin.js';
import {validId,validateAdminInput} from './service.js';
import {mountExtendedAdminRoutes} from './extended-routes.js';
import {mountAdminImageRoutes} from './image-upload.js';

export function adminRoutes(config,repository,sessions) {
    const router=Router();

    router.use((req,res,next)=>{
        if (config.provider!=='mastodon'&&(config.nodeEnv==='production'||config.provider!=='dev')) {
            throw new AppError(503,'ADMIN_AUTH_HOLD','지원하지 않는 관리자 인증입니다.');
        }
        next();
    });

    router.use(sessions.require,requireAdmin);
    mountAdminImageRoutes(router);
    router.get('/access',(req,res)=>ok(res,{
        role:'ADMIN',
        authentication:config.provider==='mastodon'?'MASTODON':'DEV',
        productionReady:config.provider==='mastodon'
    }));

    router.use((req,res,next)=>{
        if (!repository.listAdminRecords || !repository.getAdminRecord || !repository.saveAdminRecord) {
            throw new AppError(501,'ADMIN_UNAVAILABLE','관리 데이터는 Supabase 모드에서 지원합니다.');
        }
        next();
    });

    router.get('/items/search', async (req,res) => {
        const q=req.query.q;
        const type=req.query.type??'all';

        if (typeof q!=='string'||!q.trim()||q.length>100||
            Object.keys(req.query).some(k=>!['q','rp','type'].includes(k))||
            (req.query.rp!==undefined&&req.query.rp!=='true')||
            !['all','food','failure-food'].includes(type)||
            (req.query.rp==='true'&&type!=='all')) {
            throw new AppError(400,'INVALID_SEARCH','검색어 또는 음식 유형을 확인하세요.');
        }

        ok(res,{records:await repository.searchAdminItems(q.trim(),req.query.rp==='true',type)});
    });

    for (const kind of ['items','products']) {
        router.get(`/${kind}`,async(req,res)=>{
            const after=req.query.after ?? '0';

            if (Object.keys(req.query).some(key=>key!=='after') || (after!=='0'&&!validId(after))) {
                throw new AppError(400,'INVALID_CURSOR','올바른 after ID가 필요합니다.');
            }

            const records=await repository.listAdminRecords(kind,after);
            ok(res,{records,nextAfter:records.length===100?records.at(-1).id:null});
        });

        router.get(`/${kind}/:id`,async(req,res)=>{
            if (!validId(req.params.id))throw new AppError(400,'INVALID_ID','올바른 ID가 필요합니다.');
            ok(res,{record:await repository.getAdminRecord(kind,req.params.id)});
        });

        for (const method of ['post','patch']) {
            router[method](`/${kind}${method==='patch'? '/:id':''}`,async(req,res)=>{
                const id=req.params.id || null;
                if (id&&!validId(id))throw new AppError(400,'INVALID_ID','올바른 ID가 필요합니다.');

                const {patch,requestKey}=validateAdminInput(kind,req.body,!id);
                ok(res,{
                    record:await repository.saveAdminRecord(req.auth.user.id,kind,id,patch,requestKey)
                },id?200:201);
            });
        }
    }

    mountExtendedAdminRoutes(router,repository);
    return router;
}