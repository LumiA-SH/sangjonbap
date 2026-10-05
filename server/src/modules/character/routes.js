import {Router} from 'express';
import {ok, AppError} from '../../shared/http.js';
import {createCharacterService} from './service.js';

export function characterRoutes(repository, sessions) {
  const router = Router();
  const service = createCharacterService(repository);

  router.use(sessions.require);

  const found = c => {
    if (!c) throw new AppError(404, 'CHARACTER_NOT_FOUND', '연결된 활성 캐릭터가 없습니다.');
    return c;
  };

  router.get('/me', async (req, res) => {
    const character = await repository.getCharacter(req.auth.user.id);
    ok(res, {character: found(character)});
  });

  router.patch('/me/profile', async (req, res) => {
    const body = req.body;

    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 ||
        typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 40) {
      throw new AppError(400, 'INVALID_PROFILE', 'name만 1~40자로 입력하세요.');
    }

    const character = await repository.updateProfile(req.auth.user.id, {name: body.name.trim()});
    ok(res, {character: found(character)});
  });

  // 개발 검증용. 실제 게임 기능은 각 service에서 공통 자원 로직을 호출한다.
  router.patch('/me/resources', async (req, res) => {
    const character = await service.changeResources(req.auth.user.id, req.body);
    ok(res, {character});
  });

  return router;
}