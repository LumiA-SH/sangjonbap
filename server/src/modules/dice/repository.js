import {enqueueSystemEvent} from '../mastodon-system/outbox.js';
import {randomInt, createHash} from 'node:crypto';
import {AppError} from '../../shared/http.js';
import {lockCharacterByUser, writeActionLog} from '../../shared/game.js';
import {beginGameTransaction, commitGameTransaction, rollbackGameTransaction} from '../../shared/daily-gate.js';

const DICE_TYPE = '1D100';

function dedupeKey(requestKey) {
    return createHash('sha256').update(`dice:${requestKey}`).digest('hex');
}

function formatRoll(row, postStatus = null) {
    return {
        id: String(row.id),
        dice: DICE_TYPE,
        result: Number(row.detail.result),
        createdAt: row.created_at,
        postStatus
    };
}

async function findPostStatus(client, requestKey) {
    const result = await client.query(
        'select status from public.mastodon_event where dedupe_key=$1',
        [dedupeKey(requestKey)]
    );

    return result.rows[0]?.status || null;
}

async function enqueueDicePost(client, character, requestKey, result) {
    return enqueueSystemEvent(client,{type:'dice',key:requestKey,characterId:character.id,values:{character:character.name,result:String(result)}});
}

export function createDiceRepository(pool) {
    return {
        async getLatestDice(userId) {
            const result = await pool.query(
                `select l.id,l.character_id,l.action_type,l.detail,l.created_at,l.request_key
                 from public.action_log l
                 join public.game_character c on c.id=l.character_id
                 join public.auth_user u on u.character_id=c.id
                 where u.id=$1 and u.is_active and c.is_active
                   and l.action_type='DICE_ROLL'
                 order by l.created_at desc,l.id desc
                 limit 1`,
                [userId]
            );

            const row = result.rows[0];
            if (!row) return null;

            const postStatus = await findPostStatus(pool, row.request_key);
            return formatRoll(row, postStatus);
        },

        async rollDice(userId, requestKey) {
            const client = await pool.connect();

            try {
                await beginGameTransaction(client);

                const character = await lockCharacterByUser(client, userId);
                if (!character) {
                    throw new AppError(404, 'CHARACTER_NOT_FOUND', '연결된 활성 캐릭터가 없습니다.');
                }

                const existing = (await client.query(
                    `select id,character_id,action_type,detail,created_at,request_key
                     from public.action_log where request_key=$1::uuid`,
                    [requestKey]
                )).rows[0];

                if (existing) {
                    if (String(existing.character_id) !== String(character.id) || existing.action_type !== 'DICE_ROLL') {
                        throw new AppError(409, 'REQUEST_KEY_CONFLICT', '이미 다른 요청에 사용된 요청키입니다.');
                    }

                    let postStatus = await findPostStatus(client, requestKey);



                    await commitGameTransaction(client);
                    return formatRoll(existing, postStatus);
                }

                const result = randomInt(1, 101);

                await writeActionLog(client, {
                    characterId: character.id,
                    category: 'DICE',
                    actionType: 'DICE_ROLL',
                    targetType: 'CHARACTER',
                    targetId: character.id,
                    description: `1D100 주사위 결과: ${result}`,
                    detail: {dice: DICE_TYPE, result},
                    requestKey
                });

                await enqueueDicePost(client, character, requestKey, result);

                const saved = (await client.query(
                    `select id,character_id,action_type,detail,created_at,request_key
                     from public.action_log where request_key=$1::uuid`,
                    [requestKey]
                )).rows[0];

                const postStatus = await findPostStatus(client, requestKey);

                await commitGameTransaction(client);
                return formatRoll(saved, postStatus);
            } catch (error) {
                await rollbackGameTransaction(client);

                if (error.code === '23505' && error.constraint === 'action_log_request_key_key') {
                    throw new AppError(409, 'REQUEST_KEY_CONFLICT', '요청키가 중복되었습니다. 같은 요청키로 재조회하세요.');
                }

                throw error;
            } finally {
                client.release();
            }
        }
    };
}