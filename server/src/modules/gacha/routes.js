import {Router} from 'express';
import {ok} from '../../shared/http.js';
import {createGachaService} from './service.js';
export function gachaRoutes(repository,sessions) {
    const router=Router();
    const service=createGachaService(repository);
    router.use(sessions.require);
    router.get('/catalog',async(req,res)=>ok(res,await service.getCatalog(req.auth.user.id)));
    router.post('/:gachaId/draw',async(req,res)=>ok(res,await service.draw(req.auth.user.id,req.params.gachaId,req.body)));
    return router;
}
