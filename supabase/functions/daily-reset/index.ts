import {Buffer} from 'node:buffer';
import {createHash,timingSafeEqual} from 'node:crypto';
import {loadEdgeConfig} from '../../../server/src/config/edge.js';
import {createEdgePool} from '../../../server/src/db/edge-pool.js';
import {createDailyRecovery} from '../../../server/src/modules/daily/recovery.js';

// Scheduler-only function. The 256-bit caller key lives in Supabase Vault.
const config=loadEdgeConfig(Deno.env.toObject());
const pool=createEdgePool(config);
const recoverDailyReset=createDailyRecovery(pool);

function reply(status:number,body:unknown){
    return new Response(JSON.stringify(body),{
        status,
        headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
    });
}

Deno.serve(async request=>{
    if(request.method!=='POST')return reply(405,{ok:false,code:'METHOD_NOT_ALLOWED'});
    const secret=request.headers.get('x-sangjonbap-daily-cron')||'';
    if(!/^[a-f0-9]{64}$/.test(secret))return reply(403,{ok:false,code:'CRON_AUTH_REQUIRED'});
    try{
        const expected=(await pool.query(
            'select token_sha256 from maintenance_control.daily_reset_cron_auth where singleton=true'
        )).rows[0]?.token_sha256;
        const digest=createHash('sha256').update(secret).digest();
        const stored=typeof expected==='string'&&/^[a-f0-9]{64}$/.test(expected)
            ?Buffer.from(expected,'hex'):Buffer.alloc(0);
        if(stored.length!==digest.length||!timingSafeEqual(digest,stored))
            return reply(403,{ok:false,code:'CRON_AUTH_REQUIRED'});

        const result=await recoverDailyReset();
        return reply(200,{ok:true,result});
    }catch(error){
        const code=error && typeof error==='object' && 'code' in error ? String(error.code) : '';
        console.error('Daily reset cron failed',/^[A-Z0-9_]{1,64}$/.test(code)?code:'INTERNAL_ERROR');
        return reply(503,{ok:false,code:'DAILY_RESET_FAILED'});
    }
});
