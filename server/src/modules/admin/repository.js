import {createAdminCompletionRepository} from './completion-repository.js';
import {beginGameTransaction, commitGameTransaction, rollbackGameTransaction} from '../../shared/daily-gate.js';
import {AppError} from '../../shared/http.js';
import {writeActionLog} from '../../shared/game.js';
import {validateBloodPack} from '../inventory/blood-pack.js';
import {createAdminMasterRepository} from './master-repository.js';
import {createAdminRoleRepository} from './role-repository.js';
import {createAdminBattleRepository} from './battle-repository.js';
import {createAdminSettingsRepository} from './settings-repository.js';
import {createAdminDeleteRepository} from './delete-repository.js';
import {createAdminCharacterOperations} from './character-operations.js';
import {createAdminInvestigationOperations} from './investigation-operations.js';
import {createAdminAreaMonsterOperations} from './area-monster-operations.js';
import {createOperatingPolicyRepository} from './operating-policy.js';
import {createAdminDiagnostics} from './diagnostics.js';

const tables = {items: 'item', products: 'shop_product'};
const fail = (code, message, status = 409) => {
    throw new AppError(status, code, message);
};

export function createAdminRepository(pool) {
    return {
        ...createAdminDiagnostics(pool),
        ...createAdminCompletionRepository(pool),
        ...createOperatingPolicyRepository(pool),
        ...createAdminSettingsRepository(pool),
        ...createAdminDeleteRepository(pool),
        ...createAdminCharacterOperations(pool),
        ...createAdminInvestigationOperations(pool),
        ...createAdminAreaMonsterOperations(pool),
        ...createAdminBattleRepository(pool),
        ...createAdminMasterRepository(pool),
        ...createAdminRoleRepository(pool),

        async searchAdminItems(query, rpOnly = false, type = 'all') {
            return (await pool.query(
                `select i.id::text,i.name,i.category,i.is_active,i.effect_type,i.blood_pack_kind,
                        f.item_id is not null as is_food,
                        case when f.item_id is null then null
                             when f.is_failure then 'FAILURE'
                             when exists(select 1 from public.recipe r where r.failure_item_id=i.id) then 'LEGACY_FAILURE'
                             else 'NORMAL' end as food_type
                 from public.item i
                          left join public.food_config f on f.item_id=i.id
                 where strpos(lower(i.name),lower($1))>0
                   and ($2='all'
                     or ($2='food' and f.item_id is not null and not f.is_failure
                         and not exists(select 1 from public.recipe r where r.failure_item_id=i.id))
                     or ($2='failure-food' and f.item_id is not null and f.is_failure))
                     ${rpOnly ? "and i.is_active and i.transferable and not i.usable and not i.battle_usable and i.effect_type is null and i.effect_value is null and i.use_target='NONE' and i.category<>'FOOD' and f.item_id is null" : ''}
                 order by i.name,i.id limit 30`,
                [query, type]
            )).rows;
        },

        async listAdminRecords(kind, after = '0') {
            return (await pool.query(
                `select * from public.${tables[kind]} where id>$1 order by id limit 100`,
                [after]
            )).rows;
        },

        async getAdminRecord(kind, id) {
            const row = (await pool.query(
                `select * from public.${tables[kind]} where id=$1`,
                [id]
            )).rows[0];

            if (!row) {
                fail('ADMIN_RECORD_NOT_FOUND', '대상이 없습니다.', 404);
            }

            return row;
        },

        async saveAdminRecord(userId, kind, id, patch, requestKey) {
            const c = await pool.connect();

            try {
                await beginGameTransaction(c);

                // Product first, matching purchase -> auth/character -> item order.
                let before = null;

                if (id && kind === 'products') {
                    before = (await c.query(
                        'select * from public.shop_product where id=$1 for update',
                        [id]
                    )).rows[0];

                    if (!before) {
                        fail('ADMIN_RECORD_NOT_FOUND', '상품이 없습니다.', 404);
                    }
                }

                // Hold role through commit; role revocation and this write serialize.
                const admin = (await c.query(
                    "select id from public.auth_user where id=$1 and is_active and role='ADMIN' for share",
                    [userId]
                )).rows[0];

                if (!admin) {
                    fail('ADMIN_REQUIRED', '관리자 권한이 필요합니다.', 403);
                }

                if ((await c.query(
                    'select id from public.action_log where request_key=$1',
                    [requestKey]
                )).rowCount) {
                    fail('DUPLICATE_REQUEST', '이미 처리된 요청입니다.');
                }

                if (id && kind === 'items') {
                    before = (await c.query(
                        'select * from public.item where id=$1 for update',
                        [id]
                    )).rows[0];

                    if (!before) {
                        fail('ADMIN_RECORD_NOT_FOUND', '아이템이 없습니다.', 404);
                    }
                }

                if (kind === 'products') {
                    const merged = {...before, ...patch};

                    const sold = id
                        ? Number((await c.query(
                            'select coalesce(sum(quantity),0) quantity from public.shop_purchase where product_id=$1',
                            [id]
                        )).rows[0].quantity)
                        : 0;

                    if (sold && merged.item_id !== before.item_id) {
                        fail(
                            'PRODUCT_ITEM_CHANGE_HOLD',
                            '판매 이력이 있는 상품의 아이템 교체는 보류합니다. 새 상품을 등록하세요.'
                        );
                    }

                    if (
                        merged.stock_limit !== null &&
                        merged.stock_limit !== undefined &&
                        merged.stock_limit < sold
                    ) {
                        fail(
                            'STOCK_LIMIT_CONFLICT',
                            '전체 한도는 누적 판매 수량보다 작을 수 없습니다.'
                        );
                    }

                    const item = (await c.query(
                        'select * from public.item where id=$1 for update',
                        [merged.item_id]
                    )).rows[0];

                    if (!item) {
                        fail('ITEM_NOT_FOUND', '아이템이 없습니다.', 404);
                    }

                    if (item.effect_type === 'BLOOD_PACK') {
                        validateBloodPack(item);

                        if (item.blood_pack_kind === 'FREE') {
                            if (
                                merged.price !== 0 ||
                                merged.daily_limit !== 1 ||
                                merged.purchase_limit !== null ||
                                merged.stock_limit !== null
                            ) {
                                fail(
                                    'BLOOD_PACK_CONFIG_INVALID',
                                    '무료 혈액팩은 0코인, 캐릭터별 하루 1개이며 추가 구매 한도를 두지 않습니다.'
                                );
                            }
                        } else if (
                            !Number.isInteger(merged.price) ||
                            merged.price <= 0
                        ) {
                            fail(
                                'BLOOD_PACK_CONFIG_INVALID',
                                '일반 혈액팩에는 유료 판매 가격이 필요합니다.'
                            );
                        }
                    }
                }

                if (kind === 'items') {
                    const merged = {...before, ...patch};

                    if (merged.effect_type === 'BLOOD_PACK') {
                        const correctValue = merged.blood_pack_kind === 'FREE'
                            ? 10
                            : merged.blood_pack_kind === 'STANDARD'
                                ? 30
                                : null;

                        if (
                            !correctValue ||
                            merged.effect_value !== correctValue ||
                            merged.category !== 'CONSUMABLE' ||
                            !merged.usable ||
                            merged.use_target !== 'SELF' ||
                            !merged.transferable ||
                            !merged.battle_usable
                        ) {
                            fail(
                                'BLOOD_PACK_CONFIG_INVALID',
                                '무료팩은 +10, 일반팩은 +30이며 사용·양도·전투 사용이 가능해야 합니다.'
                            );
                        }
                    } else if (
                        merged.blood_pack_kind !== null &&
                        merged.blood_pack_kind !== undefined
                    ) {
                        fail(
                            'BLOOD_PACK_CONFIG_INVALID',
                            '혈액팩이 아닌 아이템에는 혈액팩 종류를 지정할 수 없습니다.'
                        );
                    }

                    if (
                        id &&
                        [
                            'effect_type',
                            'blood_pack_kind',
                            'effect_value',
                            'usable',
                            'use_target',
                            'transferable',
                            'battle_usable'
                        ].some(key => key in patch && patch[key] !== before[key])
                    ) {
                        const referenced = await c.query(
                            'select id from public.shop_product where item_id=$1 limit 1',
                            [id]
                        );

                        if (referenced.rowCount) {
                            fail(
                                'ITEM_EFFECT_CHANGE_HOLD',
                                '상품에 연결된 아이템의 효과 교체는 새 아이템으로 등록하세요.'
                            );
                        }
                    }
                }

                const keys = Object.keys(patch);
                const values = Object.values(patch);

                // Keys come only from the service whitelist, never request keys.
                const sql = id
                    ? `update public.${tables[kind]} set ${keys.map(
                                (key, i) => `${key}=$${i + 1}`
                        ).join(',')} where id=$${keys.length + 1} returning *`
                    : `insert into public.${tables[kind]} (${keys.join(',')}) values (${keys.map(
                                (_, i) => `$${i + 1}`
                        ).join(',')}) returning *`;

                const after = (await c.query(
                    sql,
                    id ? [...values, id] : values
                )).rows[0];

                await writeActionLog(c, {
                    adminUserId: userId,
                    category: 'ADMIN',
                    actionType: `${kind === 'items' ? 'ITEM' : 'SHOP_PRODUCT'}_${id ? 'UPDATE' : 'CREATE'}`,
                    targetType: kind === 'items' ? 'ITEM' : 'SHOP_PRODUCT',
                    targetId: after.id,
                    description: '관리자 데이터 변경',
                    detail: {before, after},
                    requestKey
                });

                await commitGameTransaction(c);
                return after;
            } catch (e) {
                await rollbackGameTransaction(c);

                if (
                    e.code === '23505' &&
                    e.constraint === 'action_log_request_key_key'
                ) {
                    fail(
                        'DUPLICATE_REQUEST',
                        '이미 처리된 요청입니다.'
                    );
                }

                throw e;
            } finally {
                c.release();
            }
        }
    };
}