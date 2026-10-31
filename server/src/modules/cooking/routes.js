import {Router} from 'express';
import {ok} from '../../shared/http.js';
import {createCookingService} from './service.js';

export function cookingRoutes(repository,sessions) {
    const router=Router();
    const service=createCookingService(repository);
    router.use(sessions.require);
    router.get('/catalog',async(req,res)=>ok(res,await service.getCatalog(req.auth.user.id)));
    router.post('/recipes/:recipeId/learn',async(req,res)=>ok(res,await service.learn(req.auth.user.id,req.params.recipeId,req.body)));
    router.post('/recipes/:recipeId/cook',async(req,res)=>ok(res,await service.cook(req.auth.user.id,req.params.recipeId,req.body)));
    router.post('/foods/:itemId/eat',async(req,res)=>ok(res,await service.eat(req.auth.user.id,req.params.itemId,req.body)));
    return router;
}
