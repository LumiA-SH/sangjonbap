import {validateInitialStats} from '../character/initial-stats.js';
import {AppError} from '../../shared/http.js';
import {
    lockCharacter,
    changeCharacterResources,
    changeInventoryQuantity,
    writeActionLog
} from '../../shared/game.js';
import {requireNoActiveBattle} from '../../shared/actions.js';
import {readNumberSettings, positiveResourceNumber} from '../../shared/settings.js';
import {bloodLimit} from '../../shared/balance.js';
import {adminTransaction, requireAdminRow, checkDuplicate, fail} from './transaction.js';
import {requestKey, invalid} from './master-service.js';
import {validId} from './service.js';

export function validateCharacterOperation(body, inventory = false) {
    const key = requestKey(body);
    const fields = inventory
        ? ['itemId', 'quantity']
        : ['hp', 'blood', 'ap', 'currency', 'atk', 'def', 'agi', 'status'];

    if (Object.keys(body).some(k => !fields.includes(k) && k !== 'requestKey')) {
        invalid('허용되지 않은 캐릭터 수정 필드입니다.');
    }

    const patch = Object.fromEntries(
        fields.filter(k => Object.hasOwn(body, k)).map(k => [k, body[k]])
    );

    if (!Object.keys(patch).length) {
        invalid('수정할 값이 필요합니다.');
    }

    for (const [key, value] of Object.entries(patch)) {
        if (key === 'itemId' || key === 'status') continue;

        if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
            invalid('수정값은 비음수 정수입니다.');
        }
    }

    if (Object.hasOwn(patch, 'status') &&
        !['ALIVE', 'NEAR_DEATH', 'DEAD'].includes(patch.status)) {
        invalid('상태는 생존(ALIVE), 빈사(NEAR_DEATH), 사망(DEAD) 중 선택하세요.');
    }

    if (inventory && (!validId(body.itemId) || !Object.hasOwn(body, 'quantity'))) {
        invalid('아이템과 최종 보유 수량이 필요합니다.');
    }

    return {patch, key};
}

export function createAdminCharacterOperations(pool) {
    async function read(client, id) {
        const character = (await client.query(
            'select * from public.game_character where id=$1',
            [id]
        )).rows[0];

        if (!character) {
            fail('CHARACTER_NOT_FOUND', '캐릭터가 없습니다.', 404);
        }

        const inventory = (await client.query(
            `select i.item_id, i.quantity, m.name, m.category
             from public.inventory i
                      join public.item m on m.id=i.item_id
             where i.character_id=$1
             order by i.item_id`,
            [id]
        )).rows;

        return {character, inventory};
    }

    return {
        initializeAdminCharacter(actor, id, body) {
            const key = requestKey(body);
            const allowed = [
                'requestKey',
                'expectedUpdatedAt',
                'hunter_grade',
                'has_ability',
                'ability_grade',
                'atk',
                'def',
                'agi'
            ];

            if (Object.keys(body).some(k => !allowed.includes(k)) ||
                typeof body.expectedUpdatedAt !== 'string') {
                invalid('초기 설정과 현재 버전이 필요합니다.');
            }

            const stats = validateInitialStats(body.hunter_grade, body);

            if (typeof body.has_ability !== 'boolean' ||
                (body.has_ability
                    ? !['E', 'D', 'C', 'B', 'A', 'S'].includes(body.ability_grade)
                    : body.ability_grade !== null)) {
                invalid('이능 보유 여부와 등급을 확인하세요.');
            }

            return adminTransaction(pool, async c => {
                await requireAdminRow(c, actor);
                await checkDuplicate(c, key);

                const before = await lockCharacter(c, id);

                if (!before) {
                    fail('CHARACTER_NOT_FOUND', '캐릭터가 없습니다.', 404);
                }

                if (before.initial_setup_complete !== false) {
                    fail('CHARACTER_ALREADY_CONFIGURED', '초기 설정이 이미 완료되었습니다.');
                }

                if (new Date(before.updated_at).toISOString() !== body.expectedUpdatedAt) {
                    fail('ADMIN_EDIT_CONFLICT', '캐릭터가 변경되었습니다. 다시 조회하세요.');
                }

                await requireNoActiveBattle(c, before);

                await c.query(
                    `update public.game_character
                     set hunter_grade=$2,
                         has_ability=$3,
                         ability_grade=$4,
                         atk=$5,
                         def=$6,
                         agi=$7,
                         initial_setup_complete=true,
                         updated_at=clock_timestamp()
                     where id=$1`,
                    [
                        id,
                        body.hunter_grade,
                        body.has_ability,
                        body.ability_grade,
                        stats.atk,
                        stats.def,
                        stats.agi
                    ]
                );

                const after = await read(c, id);

                await writeActionLog(c, {
                    adminUserId: actor,
                    characterId: id,
                    category: 'ADMIN',
                    actionType: 'CHARACTER_INITIAL_SETTINGS',
                    targetType: 'CHARACTER',
                    targetId: id,
                    description: '관리자 게임 초기 능력치 설정',
                    detail: {before, after: after.character},
                    requestKey: key
                });

                return after;
            });
        },

        async searchAdminCharacters(query, after = '0') {
            const result = await pool.query(
                `select c.id,
                        c.name,
                        c.status,
                        c.is_active,
                        c.profile_image_url,
                        c.hunter_grade,
                        c.ability_grade,
                        c.has_ability,
                        c.initial_setup_complete,
                        u.id as user_id,
                        u.role as user_role
                 from public.game_character c
                          left join public.auth_user u on u.character_id=c.id
                 where c.id>$2
                   and strpos(lower(c.name), lower($1))>0
                 order by c.id
                     limit 50`,
                [query, after]
            );

            return result.rows;
        },

        getAdminCharacter: id => read(pool, id),

        saveAdminCharacter(actor, id, body, inventory = false) {
            const {patch, key} = validateCharacterOperation(body, inventory);

            return adminTransaction(pool, async c => {
                await requireAdminRow(c, actor);
                await checkDuplicate(c, key);

                const before = await lockCharacter(c, id);

                if (!before) {
                    fail('CHARACTER_NOT_FOUND', '활성 캐릭터가 없습니다.', 404);
                }

                await requireNoActiveBattle(c, before);

                let detail;

                if (inventory) {
                    const item = await c.query(
                        'select id from public.item where id=$1 for update',
                        [patch.itemId]
                    );

                    if (!item.rowCount) {
                        fail('ITEM_NOT_FOUND', '아이템이 없습니다.', 404);
                    }

                    const owned = (await c.query(
                        `select quantity
                         from public.inventory
                         where character_id=$1 and item_id=$2
                             for update`,
                        [id, patch.itemId]
                    )).rows[0];

                    const delta = patch.quantity - Number(owned?.quantity || 0);

                    const result = await changeInventoryQuantity(
                        c,
                        id,
                        patch.itemId,
                        delta
                    );

                    if (!result.ok) {
                        fail('INVENTORY_CONFLICT', '인벤토리를 다시 확인하세요.');
                    }

                    detail = {
                        itemId: patch.itemId,
                        before: result.before,
                        after: result.after
                    };
                } else {
                    // 관리자 HP 수정은 일반 부활 처리와 구분한다.
                    // 부활 횟수 증가 및 마스토돈 공지 발송 없이 상태를 복구한다.
                    const adminHpRecovery =
                        before.status === 'DEAD' &&
                        Object.hasOwn(patch, 'hp') &&
                        patch.hp > 0;

                    const explicitStatus = Object.hasOwn(patch, 'status');
                    const stateCorrection = explicitStatus && patch.status !== before.status;

                    const nextHp = Object.hasOwn(patch, 'hp')
                        ? patch.hp
                        : Number(before.hp);

                    const nextBlood = Object.hasOwn(patch, 'blood')
                        ? patch.blood
                        : Number(before.blood);

                    // 관리자가 직접 상태를 지정한 경우 HP·혈량과 일치하는지 확인
                    if (explicitStatus) {
                        const validStatus = patch.status === 'DEAD'
                            ? nextHp === 0
                            : patch.status === 'NEAR_DEATH'
                                ? nextHp > 0 && nextBlood === 0
                                : nextHp > 0 && nextBlood > 0;

                        if (!validStatus) {
                            throw new AppError(
                                400,
                                'ADMIN_STATUS_RESOURCE_CONFLICT',
                                '생존은 HP·혈량 1 이상, 빈사는 HP 1 이상·혈량 0, 사망은 HP 0이어야 합니다.'
                            );
                        }
                    }

                    const limits = {
                        hp: Number(before.max_hp),
                        blood: bloodLimit(before),
                        ap: Number(before.max_ap)
                    };

                    for (const key of Object.keys(limits)) {
                        if (patch[key] !== undefined && patch[key] > limits[key]) {
                            throw new AppError(
                                400,
                                'RESOURCE_LIMIT_CONFLICT',
                                `${key} 최대값을 초과합니다.`
                            );
                        }
                    }

                    const stats = ['atk', 'def', 'agi'].filter(
                        key => Object.hasOwn(patch, key)
                    );

                    if (stats.length) {
                        const {permanent_stat_cap: cap} = await readNumberSettings(c, {
                            permanent_stat_cap: positiveResourceNumber
                        });

                        if (stats.some(key => patch[key] > Math.min(40, cap))) {
                            throw new AppError(
                                400,
                                'STAT_CAP_CONFLICT',
                                '영구 스탯 상한을 초과합니다.'
                            );
                        }
                    }

                    const deltas = Object.fromEntries(
                        ['hp', 'blood', 'ap', 'currency']
                            .filter(key => Object.hasOwn(patch, key))
                            .map(key => [key, patch[key] - Number(before[key])])
                    );

                    if (stateCorrection) {
                        // 관리자가 상태를 직접 정정한 경우 일반 사망·부활 판정은 실행하지 않는다.
                        // death_count, revive_count 및 마스토돈 이벤트는 변경하지 않는다.
                        await c.query(
                            `update public.game_character
                             set hp=$2,
                                 blood=$3,
                                 ap=$4,
                                 currency=$5,
                                 status=$6
                             where id=$1`,
                            [
                                id,
                                nextHp,
                                nextBlood,
                                Object.hasOwn(patch, 'ap')
                                    ? patch.ap
                                    : Number(before.ap),
                                Object.hasOwn(patch, 'currency')
                                    ? patch.currency
                                    : Number(before.currency),
                                patch.status
                            ]
                        );
                    } else {
                        // 기존 공용 자원 변경 로직 유지
                        await changeCharacterResources(c, before, deltas);

                        if (adminHpRecovery) {
                            // HP가 복구된 사망 캐릭터의 상태를 갱신한다.
                            // 일반 부활 함수는 호출하지 않는다.
                            await c.query(
                                `update public.game_character
                                 set status=case
                                     when blood=0 then 'NEAR_DEATH'
                                     else 'ALIVE'
                                 end
                                 where id=$1`,
                                [id]
                            );
                        }
                    }

                    // 능력치 변경
                    if (stats.length) {
                        const columns = stats.map(
                            (key, index) => `${key}=$${index + 1}`
                        ).join(', ');

                        const values = [
                            ...stats.map(key => patch[key]),
                            id
                        ];

                        await c.query(
                            `update public.game_character
                             set ${columns}
                             where id=$${stats.length + 1}`,
                            values
                        );
                    }

                    const after = (await read(c, id)).character;

                    detail = {
                        before,
                        after,
                        ...(stateCorrection
                            ? {adminStatusCorrectionWithoutLifecycleEvent: true}
                            : {}),
                        ...(adminHpRecovery
                            ? {adminHpRecoveryWithoutRevive: true}
                            : {})
                    };
                }

                await writeActionLog(c, {
                    adminUserId: actor,
                    characterId: id,
                    category: 'ADMIN',
                    actionType: inventory
                        ? 'CHARACTER_INVENTORY_UPDATE'
                        : 'CHARACTER_UPDATE',
                    targetType: 'CHARACTER',
                    targetId: id,
                    description: '관리자 캐릭터 운영 수정',
                    detail,
                    requestKey: key
                });

                return read(c, id);
            });
        }
    };
}