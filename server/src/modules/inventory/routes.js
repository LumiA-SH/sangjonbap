import {Router} from 'express';
import {ok} from '../../shared/http.js';
import {createInventoryService} from './service.js';

export function inventoryRoutes(repository, sessions) {
    const router = Router();
    const service = createInventoryService(repository);

    router.use(sessions.require);

    router.get('/me', async (req,res) => {
        const items = await service.getInventory(req.auth.user.id);
        ok(res, {items});
    });

    router.get('/storage', async (req,res) => {
        const items = await service.getStorage();
        ok(res, {items});
    });

    router.post('/storage/deposit', async (req,res) => {
        const result = await service.deposit(req.auth.user.id, req.body);
        ok(res, result);
    });

    router.post('/storage/withdraw', async (req,res) => {
        const result = await service.withdraw(req.auth.user.id, req.body);
        ok(res, result);
    });

    return router;
}