import {Router} from 'express';
import {ok} from '../../shared/http.js';
import {createInvestigationService} from './service.js';

export function investigationRoutes(repository, sessions) {
  const router = Router();
  const service = createInvestigationService(repository);
  router.use(sessions.require);

  router.get('/areas', async (req, res) => {
    ok(res, await service.getAreas(req.auth.user.id));
  });

  router.post('/:areaId', async (req, res) => {
    const result = await service.investigate(req.auth.user.id, req.params.areaId, req.body);
    ok(res, result);
  });
  return router;
}
