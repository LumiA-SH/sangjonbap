import {Router} from 'express';
import {ok} from '../../shared/http.js';
import {createShopService} from './service.js';

export function shopRoutes(repository, sessions) {
    const router = Router();
    const service = createShopService(repository);
    router.use(sessions.require);
    router.get('/products', async (req, res) => ok(res, await service.getProducts(req.auth.user.id)));
    router.post('/products/:productId/buy', async (req, res) => {
        ok(res, await service.buy(req.auth.user.id, req.params.productId, req.body));
    });
    return router;
}
