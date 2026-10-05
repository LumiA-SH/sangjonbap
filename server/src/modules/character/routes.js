import {Router} from 'express';
import {ok,AppError} from '../../shared/http.js';
export function characterRoutes(repository,sessions) {
  const router=Router();router.use(sessions.require);
  const found=c=>{if(!c)throw new AppError(404,'CHARACTER_NOT_FOUND','연결된 활성 캐릭터가 없습니다.');return c;};
  router.get('/me',async(req,res)=>ok(res,{character:found(await repository.getCharacter(req.auth.user.id))}));
  router.patch('/me/profile',async(req,res)=>{
    const body=req.body;
    if(!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.name!=='string'||body.name.trim().length<1||body.name.trim().length>40)throw new AppError(400,'INVALID_PROFILE','name만 1~40자로 입력하세요.');
    ok(res,{character:found(await repository.updateProfile(req.auth.user.id,{name:body.name.trim()}))});
  });
  return router;
}
