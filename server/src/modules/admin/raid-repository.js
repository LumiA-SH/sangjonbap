import {AppError} from '../../shared/http.js';
import {attackDamage, sampleUnit} from '../battle/engine.js';
import {randomUnit} from '../investigation/random.js';
import {readNumberSettings} from '../../shared/settings.js';
import {adminTransaction, requireAdminRow, checkDuplicate} from './transaction.js';
import {requestKey} from './master-service.js';
import {writeActionLog} from '../../shared/game.js';

const grades = new Set(['E', 'D', 'C', 'B', 'A', 'S']);
const invalid = message => { throw new AppError(400, 'INVALID_RAID_INPUT', message); };

function integer(value, min, max = 2147483647) {
    return Number.isInteger(value) && value >= min && value <= max;
}

function validateAttack(body, apply = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('공격 정보가 필요합니다.');
    const allowed = apply
        ? ['action', 'atk', 'abilityGrade', 'roll', 'damage', 'version', 'requestKey']
        : ['action', 'atk', 'abilityGrade'];

    if (Object.keys(body).some(key => !allowed.includes(key))) invalid('지원하지 않는 공격 필드입니다.');
    if (!['ATTACK', 'ABILITY'].includes(body.action) || !integer(body.atk, 0, 1000000)) {
        invalid('일반/이능공격과 ATK(0~1000000)를 확인하세요.');
    }
    if (body.action === 'ABILITY' ? !grades.has(body.abilityGrade) : body.abilityGrade !== null) {
        invalid('이능공격에만 E~S 등급을 지정하세요.');
    }
    if (apply && (!integer(body.roll, 1, 10) || !integer(body.damage, 1) || !integer(body.version, 0))) {
        invalid('계산 결과를 다시 확인해 주세요.');
    }
    return body;
}

export function calculateRaidDamage({action, atk, abilityGrade, bossDef, roll, multiplier = 1}) {
    const base = attackDamage(atk, bossDef, roll);
    return action === 'ABILITY' ? Math.max(1, Math.floor(base * multiplier)) : base;
}

async function calculate(client, input, bossDef, roll) {
    let multiplier = 1;
    if (input.action === 'ABILITY') {
        const key = 'battle_ability_' + input.abilityGrade.toLowerCase() + '_multiplier';
        const settings = await readNumberSettings(client, {[key]: {min: 0.01, max: 1000}});
        multiplier = settings[key];
    }
    const damage = calculateRaidDamage({...input, bossDef, roll, multiplier});
    if (!integer(damage, 1)) invalid('계산 결과가 허용 범위를 벗어났습니다.');
    return {damage, multiplier};
}

function bossRow(row) {
    if (!row) return null;
    return {
        maxHp: row.max_hp,
        currentHp: row.current_hp,
        def: row.def,
        version: row.version
    };
}

export function createAdminRaidRepository(pool, {random = randomUnit} = {}) {
    return {
        async getAdminRaid() {
            const result = await pool.query('select * from public.raid_boss_state where id=1');
            return {boss: bossRow(result.rows[0])};
        },

        setupAdminRaid(actor, body) {
            if (!body || typeof body !== 'object' || Array.isArray(body) ||
                Object.keys(body).some(k => !['maxHp', 'def', 'requestKey'].includes(k)) ||
                !integer(body.maxHp, 1) || !integer(body.def, 0, 1000000)) {
                invalid('보스 최대 HP 및 DEF를 확인하세요.');
            }
            const key = requestKey(body);
            return adminTransaction(pool, async client => {
                await requireAdminRow(client, actor);
                await checkDuplicate(client, key);
                const before = (await client.query('select * from public.raid_boss_state where id=1 for update')).rows[0] ?? null;
                const result = await client.query(
                    'insert into public.raid_boss_state(id,max_hp,current_hp,def,version) values(1,$1,$1,$2,0) ' +
                    'on conflict(id) do update set max_hp=excluded.max_hp,current_hp=excluded.max_hp,def=excluded.def,' +
                    'version=public.raid_boss_state.version+1,updated_at=now() returning *',
                    [body.maxHp, body.def]
                );
                const after = result.rows[0];
                await writeActionLog(client, {
                    adminUserId: actor, category: 'ADMIN', actionType: 'RAID_BOSS_RESET',
                    description: '레이드 보스 HP 및 DEF 설정',
                    detail: {before: bossRow(before), after: bossRow(after)}, requestKey: key
                });
                return {boss: bossRow(after)};
            });
        },

        async previewAdminRaid(body) {
            const input = validateAttack(body);
            const result = await pool.query('select * from public.raid_boss_state where id=1');
            const boss = result.rows[0];
            if (!boss) throw new AppError(409, 'RAID_NOT_CONFIGURED', '먼저 보스 HP와 DEF를 설정해 주세요.');
            if (boss.current_hp <= 0) throw new AppError(409, 'RAID_ENDED', '보스 HP가 0입니다.');
            const roll = 1 + Math.floor(sampleUnit(random) * 10);
            const calculated = await calculate(pool, input, boss.def, roll);
            return {
                boss: bossRow(boss),
                preview: {action: input.action, atk: input.atk, abilityGrade: input.abilityGrade,
                    roll, damage: calculated.damage, multiplier: calculated.multiplier, version: boss.version}
            };
        },

        applyAdminRaid(actor, body) {
            const input = validateAttack(body, true);
            const key = requestKey(body);
            return adminTransaction(pool, async client => {
                await requireAdminRow(client, actor);
                await checkDuplicate(client, key);
                const boss = (await client.query('select * from public.raid_boss_state where id=1 for update')).rows[0];
                if (!boss) throw new AppError(409, 'RAID_NOT_CONFIGURED', '먼저 보스를 설정해 주세요.');
                if (boss.version !== input.version) {
                    throw new AppError(409, 'RAID_STATE_CHANGED', '보스 상태가 변경되었습니다. 다시 계산해 주세요.');
                }
                if (boss.current_hp <= 0) throw new AppError(409, 'RAID_ENDED', '보스 HP가 0입니다.');
                const calculated = await calculate(client, input, boss.def, input.roll);
                if (calculated.damage !== input.damage) {
                    throw new AppError(409, 'RAID_DAMAGE_CHANGED', '계산 결과가 달라졌습니다. 다시 계산해 주세요.');
                }
                const afterHp = Math.max(0, boss.current_hp - calculated.damage);
                const result = await client.query(
                    'update public.raid_boss_state set current_hp=$1,version=version+1,updated_at=now() where id=1 returning *',
                    [afterHp]
                );
                await writeActionLog(client, {
                    adminUserId: actor, category: 'ADMIN', actionType: 'RAID_DAMAGE_APPLIED',
                    description: '레이드 공격 피해 ' + calculated.damage + ' 적용',
                    detail: {beforeHp: boss.current_hp, afterHp, damage: calculated.damage,
                        action: input.action, atk: input.atk, abilityGrade: input.abilityGrade,
                        roll: input.roll, multiplier: calculated.multiplier},
                    requestKey: key
                });
                return {boss: bossRow(result.rows[0]), appliedDamage: calculated.damage};
            });
        }
    };
}
