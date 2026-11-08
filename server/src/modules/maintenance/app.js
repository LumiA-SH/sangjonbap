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
    app.post('/maintenance/daily-reset',async(req,res)=>{
        if(!executionReady)throw new AppError(503,'MAINTENANCE_CONCURRENCY_HOLD','동시성 검증 및 활성화 승인이 필요합니다.');
        ok(res,{reset:await repository.recoverDailyReset()});
    });
    app.post('/maintenance/battle-expiry',async(req,res)=>{
        if(!executionReady)throw new AppError(503,'MAINTENANCE_CONCURRENCY_HOLD','동시성 검증 및 활성화 승인이 필요합니다.');
        ok(res,{expired:await repository.expireBattles({limit:10})});
    });
    app.post('/maintenance',async(req,res)=>{
        if(!executionReady)throw new AppError(503,'MAINTENANCE_CONCURRENCY_HOLD','동시성 검증 및 활성화 승인이 필요합니다.');
        const reset=await repository.recoverDailyReset();
        if(reset.hold)return ok(res,{hold:reset.hold,expired:0});
        const expired=await repository.expireBattles({limit:10});
        ok(res,{reset,expired});
    });
    app.use(()=>{throw new AppError(404,'NOT_FOUND','허용된 유지관리 경로가 아닙니다.');});
    app.use(errorHandler);return app;
}

