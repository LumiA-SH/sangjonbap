import {randomBytes} from 'node:crypto';
import {AppError} from '../../shared/http.js';
export function createSessions(repository,{ttl=3600000,now=Date.now}={}) {
  const sessions=new Map();
  const prune=()=>{for(const [token,s] of sessions)if(s.expires<=now())sessions.delete(token);};
  return {
    issue(user){prune();if(sessions.size>=1000)throw new AppError(429,'SESSION_LIMIT','서버를 재시작하거나 기존 세션을 종료하세요.');const token=randomBytes(32).toString('hex');sessions.set(token,{userId:user.id,expires:now()+ttl});return {token,expiresIn:ttl/1000};},
    revoke(token){sessions.delete(token);},
    async require(req,res,next){const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];const s=sessions.get(token);if(!s||s.expires<=now()){sessions.delete(token);throw new AppError(401,'UNAUTHORIZED','로그인이 필요합니다.');}const user=await repository.getUser(s.userId);if(!user?.is_active){sessions.delete(token);throw new AppError(401,'UNAUTHORIZED','계정이 비활성화되었습니다.');}req.auth={user,token};next();}
  };
}
