import {randomBytes,createHash} from 'node:crypto';
import {AppError} from '../../shared/http.js';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const sessionLifetimeSeconds=604800;
export const sessionCookie='__Host-sangjonbap-session';
export function readCookie(req,name) {
    const values=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
    return values.length===1?values[0].slice(name.length+1):null;
}
export const secureCookie={httpOnly:true,secure:true,sameSite:'lax',path:'/'};
export function createOAuthSessions(repository,origin) {
    return {
        async issue(user){const token=randomBytes(32).toString('hex');await repository.saveOAuthSession(digest(token),user.id);return {token,expiresIn:sessionLifetimeSeconds};},
        async revoke(token){if(token)await repository.revokeOAuthSession(digest(token));},
        async require(req,res,next){
            if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==origin)
                throw new AppError(403,'CSRF_DENIED','동일 사이트에서 요청하세요.');
            const token=readCookie(req,sessionCookie);
            const user=/^[a-f0-9]{64}$/.test(token||'')?await repository.getOAuthSession(digest(token)):null;
            if(!user){res.clearCookie(sessionCookie,secureCookie);throw new AppError(401,'UNAUTHORIZED','로그인이 필요합니다.');}
            req.auth={user,token};next();
        }
    };
}
