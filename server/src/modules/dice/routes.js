import {Router} from 'express';
import {AppError, ok} from '../../shared/http.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function diceRoutes(repository, sessions) {
    const router = Router();
    router.use(sessions.require);

    router.get('/latest', async (req, res) => {
        if (!req.auth.user.character_id) {
            throw new AppError(403, 'CHARACTER_REQUIRED', '캐릭터 연결이 필요합니다.');
        }

        if (!repository.getLatestDice) {
            throw new AppError(501, 'DICE_UNAVAILABLE', '주사위 기능을 사용할 수 없습니다.');
        }

        ok(res, {roll: await repository.getLatestDice(req.auth.user.id)});
    });

    router.post('/roll', async (req, res) => {
        if (!req.auth.user.character_id) {
            throw new AppError(403, 'CHARACTER_REQUIRED', '캐릭터 연결이 필요합니다.');
        }

        const body = req.body;

        if (!body || Array.isArray(body) || Object.keys(body).length !== 1 ||
            typeof body.requestKey !== 'string' || !uuidPattern.test(body.requestKey)) {
            throw new AppError(400, 'INVALID_DICE_REQUEST', '올바른 requestKey UUID가 필요합니다.');
        }

        if (!repository.rollDice) {
            throw new AppError(501, 'DICE_UNAVAILABLE', '주사위 기능을 사용할 수 없습니다.');
        }

        ok(res, {roll: await repository.rollDice(req.auth.user.id, body.requestKey.toLowerCase())});
    });

    return router;
}