import {Router} from 'express';
import {AppError,ok} from '../../shared/http.js';
import {requestKey} from '../admin/master-service.js';

export function trainingRoutes(repository,sessions) {
    const router=Router();router.use(sessions.require);
    router.post('/',async(req,res)=>{
        if(!req.body||Object.keys(req.body).some(k=>k!=='requestKey'))throw new AppError(400,'INVALID_REQUEST','requestKey만 입력하세요.');
        const key=requestKey(req.body);
        if(!repository.trainCharacter)throw new AppError(501,'TRAINING_UNAVAILABLE','Supabase 모드가 필요합니다.');
        ok(res,await repository.trainCharacter(req.auth.user.id,key));
    });
    return router;
}
