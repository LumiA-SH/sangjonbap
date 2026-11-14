import {Router} from 'express';
import {ok, AppError} from '../../shared/http.js';
import {createCharacterService} from './service.js';
import {createCharacterCareService} from './care-service.js';

export function characterRoutes(repository, sessions,config={}) {
  const router = Router();
  const service = createCharacterService(repository);
  const care = createCharacterCareService(repository);

  router.use(sessions.require);
  router.post('/',async(req,res)=>{
    // Character identity is created only from a verified OAuth response.
    if(req.auth.user.character_id)throw new AppError(409,'CHARACTER_ALREADY_LINKED','이미 연결된 캐릭터가 있습니다.');
    throw new AppError(403,'CHARACTER_OAUTH_LINK_REQUIRED','Mastodon으로 다시 로그인하여 캐릭터 연결을 확인해 주세요.');
  });

  router.get('/search', async (req, res) => {
    const q = req.query.q;
    if (Object.keys(req.query).some(key => key !== 'q') || typeof q !== 'string' ||
        !q.trim() || q.trim().length > 40) {
      throw new AppError(400, 'INVALID_CHARACTER_SEARCH', '검색어는 1~40자로 입력하세요.');
    }
    const characters = await repository.searchCharacters(q.trim());
    ok(res, {characters});
  });

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
    if(config.provider==='mastodon'||config.nodeEnv==='production')throw new AppError(403,'DEV_ACTION_DISABLED','개발용 자원 변경은 사용할 수 없습니다.');
    const character = await service.changeResources(req.auth.user.id, req.body);
    ok(res, {character});
  });

  router.post('/:characterId/heal', async (req, res) => {
    ok(res, await care.heal(req.auth.user.id, req.params.characterId, req.body));
  });

  router.post('/:characterId/revive', async (req, res) => {
    ok(res, await care.revive(req.auth.user.id, req.params.characterId, req.body));
  });

  const interaction = name => {
    if(typeof repository[name]!=='function')throw new AppError(501,'CHARACTER_INTERACTION_UNAVAILABLE','이 기능은 PostgreSQL 연결 환경에서 지원합니다.');
    return repository[name];
  };
  router.get('/:characterId/public',async(req,res)=>ok(res,await interaction('getPublicCharacter')(req.auth.user.id,req.params.characterId)));
  router.get('/:characterId/care-preview',async(req,res)=>ok(res,await interaction('previewCare')(req.auth.user.id,req.params.characterId,req.query.action)));
  router.post('/:characterId/coins',async(req,res)=>ok(res,await interaction('transferCoins')(req.auth.user.id,req.params.characterId,req.body)));
  return router;
}