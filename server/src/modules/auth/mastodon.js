import {Router} from 'express';
import {randomBytes,createHash} from 'node:crypto';
import {AppError} from '../../shared/http.js';
import {digest,readCookie,secureCookie,sessionCookie} from './oauth-session.js';

const stateCookie='__Host-sangjonbap-oauth';
export function mastodonRoutes(config,repository,sessions,{fetchImpl=fetch}={}) {
    const router=Router(),instance='https://survival-bob.site';
    let loginWindow=Date.now(),loginStarts=0;
    const fail=(code,message,status=400)=>{throw new AppError(status,code,message);};
    router.use((req,res,next)=>{res.set('Referrer-Policy','no-referrer');next();});
    router.get('/login',async(req,res)=>{
        if(Date.now()-loginWindow>=60000){loginWindow=Date.now();loginStarts=0;}
        if(++loginStarts>60)fail('RATE_LIMIT','잠시 후 다시 로그인하세요.',429);
        if(Object.keys(req.query).length)fail('INVALID_REDIRECT','로그인 경로에는 추가 매개변수를 사용할 수 없습니다.');
        const state=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url');
        await repository.saveOAuthState(digest(state),digest(verifier));
        res.cookie(stateCookie,verifier,{...secureCookie,maxAge:300000});
        const url=new URL(instance+'/oauth/authorize');
        url.search=new URLSearchParams({response_type:'code',client_id:config.oauthClientId,redirect_uri:config.oauthRedirect,
            scope:'profile',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
        res.redirect(302,url.href);
    });
    router.get('/callback',async(req,res)=>{
        const {state,code,error}=req.query,verifier=readCookie(req,stateCookie);
        res.clearCookie(stateCookie,secureCookie);
        if(typeof state!=='string'||!/^[a-f0-9]{64}$/.test(state)||!verifier||!/^[A-Za-z0-9_-]{43}$/.test(verifier)||
            !await repository.consumeOAuthState(digest(state),digest(verifier)))fail('OAUTH_STATE_INVALID','로그인 요청이 만료되었거나 일치하지 않습니다. 다시 로그인하세요.');
        if(error)fail('OAUTH_DENIED','Mastodon 로그인이 취소되었습니다.');
        if(typeof code!=='string'||!code||code.length>2048)fail('OAUTH_CODE_INVALID','인증 코드가 없습니다.');
        let identity;
        try {
            const response=await fetchImpl(instance+'/oauth/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
                headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',
                    client_id:config.oauthClientId,client_secret:config.oauthClientSecret,redirect_uri:config.oauthRedirect,code,code_verifier:verifier})});
            if(!response.ok)throw new Error('token');
            const token=await response.json();
            if(typeof token.access_token!=='string'||!token.access_token||token.token_type?.toLowerCase()!=='bearer'||
                typeof token.scope!=='string'||!token.scope.split(/\s+/).includes('profile'))throw new Error('token format');
            const account=await fetchImpl(instance+'/api/v1/accounts/verify_credentials',{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token.access_token}`}});
            if(!account.ok)throw new Error('identity');
            identity=await account.json();
            if(typeof identity.id!=='string'||!/^\d{1,100}$/.test(identity.id))throw new Error('identity format');
        } catch {fail('OAUTH_EXCHANGE_FAILED','인증 서버 확인에 실패했습니다. 다시 로그인하세요.',502);}
        const user=await repository.resolveOAuthUser('survival-bob.site',identity.id);
        await sessions.revoke(readCookie(req,sessionCookie));
        const session=await sessions.issue(user);
        res.cookie(sessionCookie,session.token,{...secureCookie,maxAge:session.expiresIn*1000});
        res.redirect(303,config.origin+'/');
    });
    return router;
}
