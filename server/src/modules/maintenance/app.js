import express from 'express';
import {Buffer} from 'node:buffer';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {AppError,errorHandler,ok} from '../../shared/http.js';

// Authentication precedes every repository call. Cron must retry on a later tick,
// never retry a possibly committed operation blindly within the HTTP request.
export function createMaintenanceApp(repository,{secret='',executionReady=false}={}) {
    if(typeof secret!=='string'||secret.length<32)throw new Error('Missing MAINTENANCE_SECRET');
    const app=express();app.set('env','production');app.disable('x-powered-by');
    app.use((req,res,next)=>{
        res.locals.requestId=randomUUID();res.set('Cache-Control','no-store');
        const supplied=Buffer.from(req.get('x-maintenance-secret')||''),expected=Buffer.from(secret);
        if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))
            throw new AppError(401,'MAINTENANCE_UNAUTHORIZED','유지관리 인증이 필요합니다.');
        if(req.headers.origin)throw new AppError(403,'MAINTENANCE_BROWSER_DENIED','브라우저 요청은 허용하지 않습니다.');
        next();
    });
    app.get('/maintenance/diagnostics/db',async(req,res)=>{
        if(!repository.diagnoseDatabase)throw new AppError(503,'MAINTENANCE_DIAGNOSTICS_UNAVAILABLE','진단 기능이 준비되지 않았습니다.');
        ok(res,await repository.diagnoseDatabase());
    });
    function resetResponse(res,reset) {
        if(reset.hold)return res.status(503).json({ok:false,error:{code:reset.hold,message:'초기화 실행이 보류되었습니다.'},data:{reset},requestId:res.locals.requestId});
        return ok(res,{reset});
    }
    async function expiryResult(res,reset) {
        const result=await repository.expireBattles({limit:10,resilient:true});
        res.locals.maintenanceResult=result;
        if(result.failed||result.deferred)return res.status(503).json({ok:false,error:{code:'MAINTENANCE_PARTIAL_FAILURE',message:'일부 전투는 후속 실행에서 재시도합니다.'},data:result,requestId:res.locals.requestId});
        return ok(res,{...(reset?{reset}:{}),expired:result.expired??result,result});
    }
    app.use((req,res,next)=>{
        const started=performance.now();
        const operation=['/maintenance','/maintenance/daily-reset','/maintenance/battle-expiry','/maintenance/diagnostics/db'].includes(req.path)?req.path:'unknown';
        res.on('finish',()=>console.info('Maintenance result',{operation,status:res.statusCode,durationMs:Math.round(performance.now()-started),requestId:res.locals.requestId,...(res.locals.maintenanceResult||{})}));
        next();
    });
    app.post('/maintenance/daily-reset',async(req,res)=>{
        if(!executionReady)throw new AppError(503,'MAINTENANCE_CONCURRENCY_HOLD','동시성 검증 및 활성화 승인이 필요합니다.');
        resetResponse(res,await repository.recoverDailyReset());
    });
    app.post('/maintenance/battle-expiry',async(req,res)=>{
        if(!executionReady)throw new AppError(503,'MAINTENANCE_CONCURRENCY_HOLD','동시성 검증 및 활성화 승인이 필요합니다.');
        await expiryResult(res);
    });
    app.post('/maintenance',async(req,res)=>{
        if(!executionReady)throw new AppError(503,'MAINTENANCE_CONCURRENCY_HOLD','동시성 검증 및 활성화 승인이 필요합니다.');
        const reset=await repository.recoverDailyReset();
        if(reset.hold)return resetResponse(res,reset);
        await expiryResult(res,reset);
    });
    app.use(()=>{throw new AppError(404,'NOT_FOUND','허용된 유지관리 경로가 아닙니다.');});
    app.use(errorHandler);return app;
}

