import {Router} from 'express';
import {ok,AppError} from '../../shared/http.js';
import {sessionCookie,secureCookie} from './oauth-session.js';
export function authRoutes(provider,sessions,config={}) {
  const router=Router();let attempts=0;let start=Date.now();
  router.get('/config',(req,res)=>ok(res,{provider:config.provider||'dev'}));
  router.post('/dev/login',async(req,res)=>{if(Date.now()-start>60000){attempts=0;start=Date.now();}if(++attempts>20)throw new AppError(429,'RATE_LIMIT','1분 후 다시 시도하세요.');const user=await provider.authenticate(req.body);ok(res,{...sessions.issue(user),user});});
  router.get('/me',sessions.require,(req,res)=>ok(res,{user:req.auth.user}));
  router.post('/logout',sessions.require,async(req,res)=>{await sessions.revoke(req.auth.token);if(config.provider==='mastodon')res.clearCookie(sessionCookie,secureCookie);ok(res,{loggedOut:true});});
  return router;
}
