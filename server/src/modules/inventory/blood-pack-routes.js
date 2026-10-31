import {AppError,ok} from '../../shared/http.js';
import {requestKey} from '../admin/master-service.js';
import {validId} from '../admin/service.js';

export function mountBloodPackRoutes(router,repository) {
    for(const action of ['use','transfer'])router.post(`/blood-packs/:itemId/${action}`,async(req,res)=>{
        const body=req.body,allowed=action==='use'?['requestKey']:['requestKey','targetId','quantity'];
        if(!validId(req.params.itemId)||!body||Object.keys(body).some(k=>!allowed.includes(k))||
            (action==='transfer'&&(!validId(body.targetId)||!Number.isInteger(body.quantity)||body.quantity<1||body.quantity>2147483647)))throw new AppError(400,'INVALID_REQUEST','ID와 수량을 확인하세요.');
        const key=requestKey(body);
        if(!repository.useBloodPack)throw new AppError(501,'ITEM_UNAVAILABLE','Supabase 모드가 필요합니다.');
        ok(res,action==='use'?await repository.useBloodPack(req.auth.user.id,req.params.itemId,key):
            await repository.transferBloodPack(req.auth.user.id,body.targetId,req.params.itemId,body.quantity,key));
    });
}
