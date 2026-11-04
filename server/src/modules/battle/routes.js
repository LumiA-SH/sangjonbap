import {Router} from 'express';
import {AppError,ok} from '../../shared/http.js';
import {validId} from '../admin/service.js';

export function validateBattleCommand(body) {
    if (!body||Array.isArray(body)||Object.keys(body).some(k=>!['requestKey','turnNo','action','itemId'].includes(k))||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey||'')||
        !Number.isSafeInteger(body.turnNo)||body.turnNo<1||!['ATTACK','ABILITY','DEFEND','ITEM','FLEE','BLOCK_FLEE'].includes(body.action)||
        (body.action==='ITEM'?!validId(body.itemId):body.itemId!==undefined)) {
        throw new AppError(400,'INVALID_BATTLE_COMMAND','requestKey, 현재 turnNo와 유효한 행동이 필요합니다.');
    }
    return {...body,requestKey:body.requestKey.toLowerCase()};
}
export function battleRoutes(repo,sessions) {
    const router=Router();
    router.use(sessions.require,(req,res,next)=>{
        if (!repo.getBattle) throw new AppError(501,'BATTLE_UNAVAILABLE','전투는 Supabase 모드에서 지원합니다.');
        next();
    });
    router.get('/current',async(req,res)=>ok(res,await repo.getBattle(req.auth.user.id)));
    router.get('/latest',async(req,res)=>ok(res,await repo.getBattle(req.auth.user.id,null,{latest:true})));
    router.use('/:id',(req,res,next)=>{if(!validId(req.params.id))throw new AppError(400,'INVALID_BATTLE_ID','전투 ID가 올바르지 않습니다.');next();});
    router.get('/:id',async(req,res)=>ok(res,await repo.getBattle(req.auth.user.id,req.params.id)));
    router.post('/:id/commands',async(req,res)=>ok(res,await repo.commandBattle(req.auth.user.id,req.params.id,validateBattleCommand(req.body))));
    return router;
}
