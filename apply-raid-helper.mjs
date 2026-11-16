import fs from 'node:fs';
import path from 'node:path';

// 생존밥 기본형 레이드 보조: 기존 파일은 최소 수정, 신규 파일은 개별 추가.
// 반드시 저장소 루트에서 실행합니다. 원본은 .patch-backups/raid-helper-* 에 백업합니다.
const root = process.cwd();
const resolved = relative => path.join(root, relative);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = '.patch-backups/raid-helper-' + stamp;

if (!fs.existsSync(resolved('frontend/src/admin/navigation.js')) ||
    !fs.existsSync(resolved('server/src/modules/admin/repository.js')) ||
    !fs.existsSync(resolved('supabase/migrations'))) {
    throw new Error('생존밥 저장소 루트에서 실행해 주세요.');
}

function replaceOnce(content, from, to, file) {
    const first = content.indexOf(from);
    if (first < 0 || content.indexOf(from, first + from.length) >= 0) {
        throw new Error(file + ': 패치 위치가 없거나 중복됩니다. 기존 코드가 바뀌었는지 확인하세요.');
    }
    return content.replace(from, to);
}

const changes = new Map();
function patch(relative, from, to) {
    const before = changes.has(relative) ? changes.get(relative) : fs.readFileSync(resolved(relative), 'utf8');
    changes.set(relative, replaceOnce(before, from, to, relative));
}
function add(relative, content) {
    if (fs.existsSync(resolved(relative))) throw new Error(relative + ': 파일이 이미 존재하여 중단합니다.');
    changes.set(relative, content.trimStart());
}

// 관리자 메뉴 구성은 자주 변경되므로 정확한 한 줄 대신 구조를 기준으로 안전하게 삽입합니다.
function patchNavigation() {
    const relative = 'frontend/src/admin/navigation.js';
    const before = fs.readFileSync(resolved(relative), 'utf8');
    let content = before;
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const adminMenus = content.match(/export\s+const\s+adminMenus\s*=\s*\[([\s\S]*?)\];/);
    if (!adminMenus) throw new Error(relative + ': adminMenus 선언을 찾지 못했습니다.');

    if (!/['"]raid-helper['"]/.test(adminMenus[1])) {
        const anchor = /^([ \t]*)\[\s*['"]battle['"]\s*,\s*['"][^'"\r\n]+['"]\s*\],?[ \t]*(\r?\n)/m;
        if (anchor.test(content)) {
            content = content.replace(anchor, (matched, indent) =>
                matched + indent + "['raid-helper', '레이드 보조']," + newline
            );
        } else {
            content = content.replace(/(export\s+const\s+adminMenus\s*=\s*\[)(\r?\n)/,
                (matched, prefix, lineBreak) => prefix + lineBreak +
                    " ['raid-helper', '레이드 보조']," + lineBreak
            );
        }
    }

    const groups = content.match(/export\s+const\s+adminMenuGroups\s*=\s*\[/);
    if (!groups) throw new Error(relative + ': adminMenuGroups 선언을 찾지 못했습니다.');
    const groupStart = content.indexOf(groups[0]) + groups[0].length;
    const groupEnd = content.indexOf('];', groupStart);
    if (groupEnd < 0) throw new Error(relative + ': adminMenuGroups 끝을 찾지 못했습니다.');
    const groupBody = content.slice(groupStart, groupEnd);

    if (!/['"]raid-helper['"]/.test(groupBody)) {
        const operationGroup = /(\{\s*title\s*:\s*['"]운영['"][^{}]*?menus\s*:\s*\[)([^\]]*)(\])/;
        if (operationGroup.test(groupBody)) {
            const next = groupBody.replace(operationGroup, (all, prefix, menus, suffix) => {
                const separator = menus.trim().endsWith(',') || !menus.trim() ? '' : ',';
                return prefix + menus + separator + "'raid-helper'" + suffix;
            });
            content = content.slice(0, groupStart) + next + content.slice(groupEnd);
        } else {
            content = content.slice(0, groupStart) + newline +
                " {title:'레이드 보조',description:'운영진 수동 데미지 계산',menus:['raid-helper']}," +
                content.slice(groupStart);
        }
    }
    changes.set(relative, content);
}
patchNavigation();
// 나머지 파일도 줄바꿈/띄어쓰기/따옴표의 사소한 변경을 허용하면서, 유일한 위치에서만 수정합니다.
function insertAfterLine(relative, pattern, addition) {
    const before = changes.has(relative) ? changes.get(relative) : fs.readFileSync(resolved(relative), 'utf8');
    const matches = [...before.matchAll(pattern)];
    if (matches.length !== 1) {
        throw new Error(relative + ': 추가 위치를 정확히 찾지 못했습니다. 현재 파일을 확인하세요.');
    }
    const newline = before.includes('\r\n') ? '\r\n' : '\n';
    const match = matches[0];
    const end = match.index + match[0].length;
    changes.set(relative, before.slice(0, end) + newline + addition + before.slice(end));
}
function insertBeforeLine(relative, pattern, addition) {
    const before = changes.has(relative) ? changes.get(relative) : fs.readFileSync(resolved(relative), 'utf8');
    const matches = [...before.matchAll(pattern)];
    if (matches.length !== 1) {
        throw new Error(relative + ': 추가 위치를 정확히 찾지 못했습니다. 현재 파일을 확인하세요.');
    }
    const newline = before.includes('\r\n') ? '\r\n' : '\n';
    const match = matches[0];
    changes.set(relative, before.slice(0, match.index) + addition + newline + before.slice(match.index));
}
insertAfterLine('frontend/src/admin/AdminPanel.js',
    /^import\s+BattleAdminPanel\s+from\s+['"]\.\/BattleAdminPanel['"];?/gm,
    "import RaidHelperPanel from './RaidHelperPanel';");
const panelFile = 'frontend/src/admin/AdminPanel.js';
const panelText = changes.get(panelFile) || fs.readFileSync(resolved(panelFile), 'utf8');
const usersLine = /^[ \t]*if\s*\(\s*kind\s*===\s*['"]users['"]\s*\)\s*return[^\r\n]*<RolePanel[^\r\n]*;/gm;
if (usersLine.test(panelText)) {
    insertBeforeLine(panelFile,
        /^[ \t]*if\s*\(\s*kind\s*===\s*['"]users['"]\s*\)\s*return[^\r\n]*<RolePanel[^\r\n]*;/gm,
        "        if(kind==='raid-helper') return <RaidHelperPanel onDenied={denied}/>;");
} else {
    insertAfterLine(panelFile,
        /^[ \t]*if\s*\(\s*kind\s*===\s*['"]battle['"]\s*\)\s*return[^\r\n]*<BattleAdminPanel[^\r\n]*;/gm,
        "        if(kind==='raid-helper') return <RaidHelperPanel onDenied={denied}/>;");
}
insertAfterLine('server/src/modules/admin/repository.js',
    /^import\s+\{\s*createAdminBattleRepository\s*\}\s+from\s+['"]\.\/battle-repository\.js['"];?/gm,
    "import {createAdminRaidRepository} from './raid-repository.js';");
insertAfterLine('server/src/modules/admin/repository.js',
    /^[ \t]*\.\.\.createAdminBattleRepository\(pool\),?/gm,
    "        ...createAdminRaidRepository(pool),");
const routes = 'server/src/modules/admin/extended-routes.js';
const routeBefore = changes.has(routes) ? changes.get(routes) : fs.readFileSync(resolved(routes), 'utf8');
const signature = /export\s+function\s+mountExtendedAdminRoutes\s*\(\s*router\s*,\s*repo\s*\)\s*\{/g;
if ([...routeBefore.matchAll(signature)].length !== 1) {
    throw new Error(routes + ': 관리자 라우트 함수를 찾지 못했습니다.');
}
changes.set(routes, routeBefore.replace(signature, found => found + "\n" +
    "    router.get('/raid-helper', async (req,res) => ok(res, await repo.getAdminRaid()));\n" +
    "    router.post('/raid-helper/setup', async (req,res) => ok(res, await repo.setupAdminRaid(req.auth.user.id, req.body)));\n" +
    "    router.post('/raid-helper/preview', async (req,res) => ok(res, await repo.previewAdminRaid(req.body)));\n" +
    "    router.post('/raid-helper/apply', async (req,res) => ok(res, await repo.applyAdminRaid(req.auth.user.id, req.body)));\n"
));

add('supabase/migrations/20261116110000_raid_helper.sql', String.raw`
-- 레이드 계산기 전용 보스 HP 상태. 참가자/턴/채팅 관리 테이블은 만들지 않는다.
create table public.raid_boss_state (
    id smallint primary key default 1 check (id = 1),
    max_hp integer not null check (max_hp > 0),
    current_hp integer not null check (current_hp >= 0 and current_hp <= max_hp),
    def integer not null check (def >= 0),
    version integer not null default 0 check (version >= 0),
    updated_at timestamptz not null default now()
);

alter table public.raid_boss_state enable row level security;
revoke all on public.raid_boss_state from anon, authenticated;
-- Express 관리자 API가 서버 DB 연결로만 조회 및 수정한다.
`);

add('server/src/modules/admin/raid-repository.js', String.raw`
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
`);

add('frontend/src/admin/RaidHelperPanel.js', String.raw`
import {useCallback, useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import './RaidHelperPanel.css';

const gradeOptions = ['E', 'D', 'C', 'B', 'A', 'S'];

export default function RaidHelperPanel({onDenied}) {
    const [boss, setBoss] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [maxHp, setMaxHp] = useState('1000');
    const [bossDef, setBossDef] = useState('0');
    const [atk, setAtk] = useState('');
    const [action, setAction] = useState('ATTACK');
    const [grade, setGrade] = useState('E');
    const [preview, setPreview] = useState(null);
    const pending = useRef(false);

    const fail = useCallback(error => {
        setError((error.code || 'REQUEST_FAILED') + ': ' + error.message);
        if ([401, 403].includes(error.status)) onDenied?.(error.message);
    }, [onDenied]);

    const load = useCallback(async () => {
        try {
            const response = await api('/admin/raid-helper');
            setBoss(response.boss);
            if (response.boss) {
                setMaxHp(String(response.boss.maxHp));
                setBossDef(String(response.boss.def));
            }
            setPreview(null);
            setError('');
        } catch (e) {
            fail(e);
        } finally {
            setLoaded(true);
        }
    }, [fail]);

    useEffect(() => { load(); }, [load]);

    function change(setter, value) {
        setter(value);
        setPreview(null);
        setNotice('');
    }

    async function request(work) {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError('');
        try {
            await work();
        } catch (e) {
            setPreview(null);
            fail(e);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }

    function resetBoss(event) {
        event.preventDefault();
        const hp = Number(maxHp);
        const def = Number(bossDef);
        if (!Number.isInteger(hp) || hp < 1 || !Number.isInteger(def) || def < 0) {
            setError('보스 HP와 DEF를 올바른 정수로 입력해 주세요.');
            return;
        }
        if (!window.confirm('보스 HP를 최대치로 초기화합니다. 기존 HP 진행 상태가 덮어써집니다. 계속할까요?')) return;
        request(async () => {
            const result = await api('/admin/raid-helper/setup', {
                method: 'POST', body: {maxHp: hp, def, requestKey: crypto.randomUUID()}
            });
            setBoss(result.boss);
            setPreview(null);
            setNotice('보스 상태를 설정했습니다.');
        });
    }

    function calculate(event) {
        event.preventDefault();
        const value = Number(atk);
        if (atk.trim() === '' || !Number.isInteger(value) || value < 0) {
            setError('ATK를 0 이상의 정수로 입력해 주세요.');
            return;
        }
        request(async () => {
            const result = await api('/admin/raid-helper/preview', {
                method: 'POST', body: {action, atk: value, abilityGrade: action === 'ABILITY' ? grade : null}
            });
            setBoss(result.boss);
            setPreview(result.preview);
            setNotice('계산 완료. 보스 HP는 아직 변경되지 않았습니다.');
        });
    }

    function apply() {
        if (!preview) return;
        request(async () => {
            const result = await api('/admin/raid-helper/apply', {
                method: 'POST', body: {
                    action: preview.action, atk: preview.atk, abilityGrade: preview.abilityGrade,
                    roll: preview.roll, damage: preview.damage, version: preview.version,
                    requestKey: crypto.randomUUID()
                }
            });
            setBoss(result.boss);
            setPreview(null);
            setAtk('');
            setNotice('데미지 ' + result.appliedDamage + ' 적용 완료. 다음 참가자의 ATK를 입력하세요.');
        });
    }

    return <div className="raid-helper">
        <p className="raid-helper-note">운영진용 수동 데미지 계산기입니다. 캐릭터 자동 조회, 행동 제출, 턴 관리는 포함되지 않습니다.</p>
        {!loaded && <p role="status">레이드 보스 정보를 불러오는 중입니다.</p>}
        {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={load}>상태 다시 불러오기</button></p>}
        {notice && <p role="status">{notice}</p>}

        <section className="raid-helper-card">
            <h3>보스 상태</h3>
            {boss ? <div className="raid-helper-hp">
                <strong>{boss.currentHp.toLocaleString()} / {boss.maxHp.toLocaleString()} HP</strong>
                <div className="raid-helper-hp-track"><span style={{width: Math.max(0, Math.min(100, boss.currentHp / boss.maxHp * 100)) + '%'}}/></div>
                <p>보스 DEF: {boss.def.toLocaleString()}</p>
            </div> : <p>보스 정보를 먼저 설정해 주세요.</p>}
            <details className="raid-helper-settings" open={!boss}>
                <summary>보스 HP · DEF 설정 / 초기화</summary>
                <form className="raid-helper-form" onSubmit={resetBoss}>
                    <label>최대 HP<input type="number" min="1" max="2147483647" step="1" value={maxHp} disabled={busy} onChange={e => setMaxHp(e.target.value)}/></label>
                    <label>보스 DEF<input type="number" min="0" max="1000000" step="1" value={bossDef} disabled={busy} onChange={e => setBossDef(e.target.value)}/></label>
                    <button type="submit" disabled={busy}>{boss ? '보스 HP 초기화 및 설정' : '보스 설정하기'}</button>
                </form>
                <small>기존 보스 HP를 덮어쓰므로 레이드 시작 전 또는 새 레이드에서만 사용하세요.</small>
            </details>
        </section>

        <section className="raid-helper-card">
            <h3>공격 데미지 계산</h3>
            <form className="raid-helper-form" onSubmit={calculate}>
                <label>공격 유형
                    <select value={action} disabled={busy || !boss} onChange={e => change(setAction, e.target.value)}>
                        <option value="ATTACK">일반공격</option>
                        <option value="ABILITY">이능공격</option>
                    </select>
                </label>
                <label>참가자 ATK (수동 입력)
                    <input type="number" min="0" max="1000000" step="1" value={atk} disabled={busy || !boss} onChange={e => change(setAtk, e.target.value)} placeholder="참가자 ATK"/>
                </label>
                {action === 'ABILITY' && <label>이능 등급
                    <select value={grade} disabled={busy || !boss} onChange={e => change(setGrade, e.target.value)}>
                        {gradeOptions.map(g => <option value={g} key={g}>{g}급</option>)}
                    </select>
                </label>}
                <button type="submit" disabled={busy || !boss || boss.currentHp <= 0}>데미지 계산하기</button>
            </form>
            <small>일반 PVE 공격식과 서버 이능 배율을 사용합니다. 이 계산기는 캐릭터의 AP를 자동 차감하지 않습니다.</small>
            {preview && <div className="raid-helper-preview">
                <div><span>계산된 데미지</span><strong>{preview.damage.toLocaleString()}</strong></div>
                <p>공격 난수: {preview.roll} / 유형: {preview.action === 'ABILITY' ? '이능공격 ' + preview.abilityGrade + '급' : '일반공격'}</p>
                <p>예상 보스 HP: {Math.max(0, boss.currentHp - preview.damage).toLocaleString()}</p>
                <button type="button" disabled={busy} onClick={apply}>이 데미지를 보스 HP에 적용</button>
            </div>}
        </section>
    </div>;
}
`);

add('frontend/src/admin/RaidHelperPanel.css', String.raw`
.raid-helper {
    display: grid;
    gap: 18px;
    max-width: 900px;
}

.raid-helper-note {
    margin: 0;
    line-height: 1.7;
}

.raid-helper-card {
    padding: 20px;
    border: 1px solid #d7d3d0;
    border-radius: 9px;
    background: #fffefa;
}

.raid-helper-card h3 {
    margin: 0 0 15px;
}

.raid-helper-hp strong {
    font-size: 24px;
}

.raid-helper-hp-track {
    height: 12px;
    margin: 12px 0;
    overflow: hidden;
    border-radius: 6px;
    background: #e8e3e1;
}

.raid-helper-hp-track span {
    display: block;
    height: 100%;
    background: #650c13;
    transition: width .2s;
}

.raid-helper-settings {
    margin-top: 16px;
}

.raid-helper-form {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: end;
    margin: 15px 0;
}

.raid-helper-form label {
    display: flex;
    flex: 1 1 170px;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}

.raid-helper-form label input,
.raid-helper-form label select {
    width: 100%;
}

.raid-helper-preview {
    display: grid;
    gap: 10px;
    margin-top: 18px;
    padding: 17px;
    border: 1px solid #bdacae;
    border-radius: 8px;
}

.raid-helper-preview > div {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
}

.raid-helper-preview strong {
    font-size: 29px;
    color: #650c13;
}

.raid-helper-preview p {
    margin: 0;
}
`);

add('server/test/admin-raid-helper.test.js', String.raw`
import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRaidDamage} from '../src/modules/admin/raid-repository.js';
import {attackDamage} from '../src/modules/battle/engine.js';

test('레이드 일반공격은 기존 PVE 공격식을 그대로 사용한다', () => {
    const input = {action: 'ATTACK', atk: 30, bossDef: 10, roll: 7};
    assert.equal(calculateRaidDamage(input), attackDamage(30, 10, 7));
});

test('레이드 이능공격은 일반공격 결과에 서버 등급 배율을 적용한다', () => {
    const base = attackDamage(30, 10, 7);
    assert.equal(calculateRaidDamage({action: 'ABILITY', atk: 30, bossDef: 10, roll: 7,
        abilityGrade: 'B', multiplier: 1.8}), Math.max(1, Math.floor(base * 1.8)));
});

test('방어력이 커도 최소 데미지는 1이다', () => {
    assert.equal(calculateRaidDamage({action: 'ATTACK', atk: 0, bossDef: 500, roll: 1}), 1);
});
`);

// 사전 검증이 끝난 뒤에만 원본을 백업하고 변경합니다. 정상 파일을 덮어쓰지 않습니다.
for (const [relative, content] of changes) {
    if (!content) throw new Error(relative + ': 빈 파일을 만들 수 없습니다.');
}
fs.mkdirSync(resolved(backupDir), {recursive: true});
for (const [relative, content] of changes) {
    const target = resolved(relative);
    if (fs.existsSync(target)) {
        const backup = resolved(path.join(backupDir, relative));
        fs.mkdirSync(path.dirname(backup), {recursive: true});
        fs.copyFileSync(target, backup);
    }
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, content, 'utf8');
    console.log('PATCHED ' + relative);
}
console.log('\n완료. 백업: ' + backupDir);
console.log('DB에 supabase/migrations/20261116110000_raid_helper.sql 적용 후 서버를 재시작하세요.');
