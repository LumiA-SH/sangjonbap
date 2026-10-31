import {timingSafeEqual} from 'node:crypto';
import {AppError} from '../../../shared/http.js';
export function createDevProvider(config,repository) {
  return {async authenticate(body) {
    if(config.nodeEnv==='production' || (config.provider && config.provider!=='dev')) throw new AppError(403,'DEV_AUTH_DISABLED','DEV 인증을 사용할 수 없는 환경입니다.');
    const supplied=Buffer.from(typeof body?.key==='string'?body.key:'');
    const expected=Buffer.from(config.loginKey);
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new AppError(401,'INVALID_CREDENTIALS','개발 로그인 키를 확인하세요.');
    const user=await repository.getUser(config.userId);
    if(!user?.is_active)throw new AppError(403,'USER_UNAVAILABLE','활성 개발 계정을 준비하세요.');
    return user;
  }};
}
