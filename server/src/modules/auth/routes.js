import {Router} from 'express';
import {ok,AppError} from '../../shared/http.js';
export function authRoutes(provider,sessions) {
  const router=Router();let attempts=0;let start=Date.now();
  router.post('/dev/login',async(req,res)=>{if(Date.now()-start>60000){attempts=0;start=Date.now();}if(++attempts>20)throw new AppError(429,'RATE_LIMIT','1분 후 다시 시도하세요.');const user=await provider.authenticate(req.body);ok(res,{...sessions.issue(user),user});});
  router.get('/me',sessions.require,(req,res)=>ok(res,{user:req.auth.user}));
  router.post('/logout',sessions.require,(req,res)=>{sessions.revoke(req.auth.token);ok(res,{loggedOut:true});});
  return router;
}
