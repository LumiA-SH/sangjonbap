import {createHash} from 'node:crypto';
import {writeActionLog} from '../../shared/game.js';
import {adminTransaction, requireAdminRow, checkDuplicate, fail} from './transaction.js';
import {requestKey, invalid} from './master-service.js';
import {validId} from './service.js';

const MAX_MONSTERS = 100;
const MAX_WEIGHT = 2147483647;

function validateAssignmentInput(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        invalid('마물 배치 설정을 확인하세요.');
    }

    const key = requestKey(body);

    if (
        Object.keys(body).some(field =>
            !['monsters', 'expectedVersion', 'requestKey'].includes(field)
        ) ||
        !Array.isArray(body.monsters) ||
        body.monsters.length > MAX_MONSTERS ||
        typeof body.expectedVersion !== 'string' ||
        !/^[0-9a-f]{64}$/i.test(body.expectedVersion)
    ) {
        invalid('구역별 마물 설정 형식이 올바르지 않습니다.');
    }

    const seen = new Set();

    for (const row of body.monsters) {
        if (
            !row ||
            typeof row !== 'object' ||
            Array.isArray(row) ||
            Object.keys(row).some(field =>
                !['monster_id', 'weight'].includes(field)
            ) ||
            !validId(row.monster_id) ||
            !Number.isInteger(row.weight) ||
            row.weight < 1 ||
            row.weight > MAX_WEIGHT
        ) {
            invalid('등장 마물과 출현 가중치를 확인하세요.');
        }

        if (seen.has(row.monster_id)) {
            invalid('동일한 마물을 한 구역에 중복 배치할 수 없습니다.');
        }

        seen.add(row.monster_id);
    }

    return {
        key,
        monsters: body.monsters,
        expectedVersion: body.expectedVersion
    };
}

function assignmentVersion(assignments) {
    const normalized = assignments
        .map(row => [
            String(row.monster_id),
            Number(row.weight)
        ])
        .sort((a, b) =>
            BigInt(a[0]) < BigInt(b[0])
                ? -1
                : BigInt(a[0]) > BigInt(b[0])
                    ? 1
                    : 0
        );

    return createHash('sha256')
        .update(JSON.stringify(normalized))
        .digest('hex');
}

async function readAreaMonsters(client, areaId) {
    const area = (await client.query(
        `select id::text,
             name,
                encounter_rate,
                is_open
         from public.area
         where id=$1`,
        [areaId]
    )).rows[0];

    if (!area) {
        fail('AREA_NOT_FOUND', '구역을 찾을 수 없습니다.', 404);
    }

    const rows = (await client.query(
        `select
             m.id::text as monster_id,
             m.name,
             m.is_active,
             am.area_id::text as assigned_area_id,
             a.name as assigned_area_name,
             am.weight
         from public.monster m
                  left join public.area_monster am
                            on am.monster_id=m.id
                  left join public.area a
                            on a.id=am.area_id
         order by m.name,m.id`
    )).rows;

    const assignments = rows
        .filter(row =>
            String(row.assigned_area_id) === String(areaId)
        )
        .map(row => ({
            monster_id: String(row.monster_id),
            name: row.name,
            is_active: row.is_active,
            weight: Number(row.weight)
        }));

    const monsters = rows.map(row => ({
        monster_id: String(row.monster_id),
        name: row.name,
        is_active: row.is_active,
        assigned_area_id: row.assigned_area_id == null
            ? null
            : String(row.assigned_area_id),
        assigned_area_name: row.assigned_area_name || null
    }));

    return {
        area: {
            id: String(area.id),
            name: area.name,
            encounter_rate: Number(area.encounter_rate),
            is_open: area.is_open
        },
        assignments,
        monsters,
        version: assignmentVersion(assignments)
    };
}

export function createAdminAreaMonsterOperations(pool) {
    return {
        async getAdminAreaMonsters(areaId) {
            if (!validId(areaId)) {
                invalid('구역 ID를 확인하세요.');
            }

            return readAreaMonsters(pool, areaId);
        },

        saveAdminAreaMonsters(actorId, areaId, body) {
            if (!validId(areaId)) {
                invalid('구역 ID를 확인하세요.');
            }

            const input = validateAssignmentInput(body);

            return adminTransaction(pool, async client => {
                // 기존 마물 저장과 동일하게 구역을 먼저 잠근다.
                await client.query(
                    'select id from public.area order by id for update'
                );

                await requireAdminRow(client, actorId);
                await checkDuplicate(client, input.key);

                const before = await readAreaMonsters(client, areaId);

                if (before.version !== input.expectedVersion) {
                    fail(
                        'AREA_MONSTER_CHANGED',
                        '다른 관리자가 마물 배치를 변경했습니다. 다시 조회하세요.'
                    );
                }

                const monsterIds = input.monsters
                    .map(row => row.monster_id)
                    .sort((a, b) =>
                        BigInt(a) < BigInt(b)
                            ? -1
                            : BigInt(a) > BigInt(b)
                                ? 1
                                : 0
                    );

                if (monsterIds.length) {
                    const existing = (await client.query(
                        `select id::text
                         from public.monster
                         where id=any($1::bigint[])
                         order by id
                             for update`,
                        [monsterIds]
                    )).rows;

                    if (existing.length !== monsterIds.length) {
                        fail(
                            'MONSTER_NOT_FOUND',
                            '등록되지 않은 마물이 포함되어 있습니다.',
                            404
                        );
                    }

                    const occupied = (await client.query(
                        `select monster_id::text,
                             area_id::text
                         from public.area_monster
                         where monster_id=any($1::bigint[])
                           and area_id<>$2
                             limit 1`,
                        [monsterIds, areaId]
                    )).rows[0];

                    if (occupied) {
                        fail(
                            'MONSTER_AREA_CONFLICT',
                            '이미 다른 구역에 배치된 마물입니다. 기존 구역에서 배치를 해제하세요.'
                        );
                    }
                }

                // 마물 본체, 행동, 드롭은 변경하지 않는다.
                await client.query(
                    'delete from public.area_monster where area_id=$1',
                    [areaId]
                );

                for (const row of input.monsters) {
                    await client.query(
                        `insert into public.area_monster(
                            area_id,
                            monster_id,
                            weight
                        )
                         values($1,$2,$3)`,
                        [
                            areaId,
                            row.monster_id,
                            row.weight
                        ]
                    );
                }

                const after = await readAreaMonsters(client, areaId);

                await writeActionLog(client, {
                    adminUserId: actorId,
                    category: 'ADMIN',
                    actionType: 'AREA_MONSTERS_UPDATE',
                    targetType: 'AREA',
                    targetId: areaId,
                    description: '구역별 등장 마물과 가중치 변경',
                    detail: {
                        before: before.assignments,
                        after: after.assignments
                    },
                    requestKey: input.key
                });

                return after;
            });
        }
    };
}