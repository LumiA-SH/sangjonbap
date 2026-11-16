import {useCallback, useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import './RaidHelperPanel.css';

const STORAGE_KEY = 'sangjonbap.raid-helper.participants.v1';
const gradeOptions = ['E', 'D', 'C', 'B', 'A', 'S'];

const emptyParticipant = {
    name: '',
    atk: '',
    def: '',
    agi: '',
    hasAbility: false,
    abilityGrade: 'E'
};

function validStat(value) {
    return Number.isInteger(value) && value >= 0 && value <= 1000000;
}

function loadParticipants() {
    try {
        const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');

        if (!Array.isArray(stored)) return [];

        return stored.filter(person =>
            person &&
            typeof person.id === 'string' &&
            typeof person.name === 'string' &&
            person.name.trim().length > 0 &&
            validStat(person.atk) &&
            validStat(person.def) &&
            validStat(person.agi) &&
            typeof person.hasAbility === 'boolean' &&
            (!person.hasAbility || gradeOptions.includes(person.abilityGrade))
        ).map(person => ({
            id: person.id,
            name: person.name,
            atk: person.atk,
            def: person.def,
            agi: person.agi,
            hasAbility: person.hasAbility,
            abilityGrade: person.hasAbility ? person.abilityGrade : null
        }));
    } catch {
        return [];
    }
}

function createId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return Date.now() + '-' + Math.random().toString(36).slice(2);
}

export default function RaidHelperPanel({onDenied}) {
    const [boss, setBoss] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const [maxHp, setMaxHp] = useState('1000');
    const [bossDef, setBossDef] = useState('0');

    const [participants, setParticipants] = useState(loadParticipants);
    const [selectedId, setSelectedId] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [draft, setDraft] = useState({...emptyParticipant});
    const [storageError, setStorageError] = useState('');

    const [atk, setAtk] = useState('');
    const [action, setAction] = useState('ATTACK');
    const [grade, setGrade] = useState('E');
    const [preview, setPreview] = useState(null);

    const pending = useRef(false);

    const selectedParticipant = participants.find(person => person.id === selectedId) || null;
    const canUseAbility = !selectedParticipant || selectedParticipant.hasAbility;

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(participants));
            setStorageError('');
        } catch {
            setStorageError('참가자 목록을 브라우저에 저장하지 못했습니다. 저장 공간 및 브라우저 설정을 확인하세요.');
        }
    }, [participants]);

    const fail = useCallback(e => {
        setError((e.code || 'REQUEST_FAILED') + ': ' + e.message);

        if ([401, 403].includes(e.status)) {
            onDenied?.(e.message);
        }
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

    useEffect(() => {
        load();
    }, [load]);

    function change(setter, value) {
        setter(value);
        setPreview(null);
        setNotice('');
        setError('');
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

    function changeDraft(key, value) {
        setDraft(current => ({
            ...current,
            [key]: value
        }));

        setError('');
    }

    function clearDraft() {
        setDraft({...emptyParticipant});
        setEditingId(null);
    }

    function selectParticipant(id) {
        if (busy) return;

        const person = participants.find(item => item.id === id) || null;

        setSelectedId(person?.id || null);
        setAtk(person ? String(person.atk) : '');
        setGrade(person?.abilityGrade || 'E');
        setAction('ATTACK');
        setPreview(null);
        setNotice('');
        setError('');
    }

    function editParticipant(person) {
        if (busy) return;

        setEditingId(person.id);
        setDraft({
            name: person.name,
            atk: String(person.atk),
            def: String(person.def),
            agi: String(person.agi),
            hasAbility: person.hasAbility,
            abilityGrade: person.abilityGrade || 'E'
        });

        setError('');
    }

    function saveParticipant(event) {
        event.preventDefault();

        if (busy) return;

        const name = draft.name.trim();
        const values = {
            atk: Number(draft.atk),
            def: Number(draft.def),
            agi: Number(draft.agi)
        };

        if (!name || name.length > 40) {
            setError('캐릭터 이름은 1~40자로 입력해 주세요.');
            return;
        }

        if (
            [draft.atk, draft.def, draft.agi].some(value => String(value).trim() === '') ||
            Object.values(values).some(value => !validStat(value))
        ) {
            setError('ATK, DEF, AGI는 0~1000000 사이의 정수로 입력해 주세요.');
            return;
        }

        if (draft.hasAbility && !gradeOptions.includes(draft.abilityGrade)) {
            setError('올바른 이능 등급을 선택해 주세요.');
            return;
        }

        const duplicated = participants.some(person =>
            person.id !== editingId &&
            person.name.toLocaleLowerCase() === name.toLocaleLowerCase()
        );

        if (duplicated) {
            setError('이미 같은 이름의 참가자가 등록되어 있습니다.');
            return;
        }

        const person = {
            id: editingId || createId(),
            name,
            ...values,
            hasAbility: draft.hasAbility,
            abilityGrade: draft.hasAbility ? draft.abilityGrade : null
        };

        setParticipants(current => {
            if (editingId) {
                return current.map(item => item.id === editingId ? person : item);
            }

            return [...current, person];
        });

        setSelectedId(person.id);
        setAtk(String(person.atk));
        setGrade(person.abilityGrade || 'E');
        setAction('ATTACK');
        setPreview(null);
        setNotice(editingId ? '참가자 정보를 수정했습니다.' : '참가자를 등록했습니다.');
        setError('');

        clearDraft();
    }

    function deleteParticipant(person) {
        if (busy) return;

        if (!window.confirm(person.name + ' 참가자를 목록에서 삭제할까요?')) {
            return;
        }

        setParticipants(current => current.filter(item => item.id !== person.id));

        if (selectedId === person.id) {
            setSelectedId(null);
            setAtk('');
            setAction('ATTACK');
            setGrade('E');
        }

        if (editingId === person.id) {
            clearDraft();
        }

        setPreview(null);
        setNotice(person.name + ' 참가자를 삭제했습니다.');
        setError('');
    }

    function resetBoss(event) {
        event.preventDefault();

        const hp = Number(maxHp);
        const def = Number(bossDef);

        if (
            !Number.isInteger(hp) || hp < 1 || hp > 2147483647 ||
            !Number.isInteger(def) || def < 0 || def > 1000000
        ) {
            setError('보스 HP와 DEF를 올바른 정수로 입력해 주세요.');
            return;
        }

        if (!window.confirm('보스 HP를 최대치로 초기화합니다. 기존 HP 진행 상태가 덮어써집니다. 계속할까요?')) {
            return;
        }

        request(async () => {
            const result = await api('/admin/raid-helper/setup', {
                method: 'POST',
                body: {
                    maxHp: hp,
                    def,
                    requestKey: crypto.randomUUID()
                }
            });

            setBoss(result.boss);
            setPreview(null);
            setNotice('보스 상태를 설정했습니다.');
        });
    }

    function calculate(event) {
        event.preventDefault();

        const value = Number(atk);

        if (atk.trim() === '' || !validStat(value)) {
            setError('ATK를 0~1000000 사이의 정수로 입력해 주세요.');
            return;
        }

        if (action === 'ABILITY' && !canUseAbility) {
            setError('이능을 보유하지 않은 참가자는 이능공격을 사용할 수 없습니다.');
            return;
        }

        request(async () => {
            const result = await api('/admin/raid-helper/preview', {
                method: 'POST',
                body: {
                    action,
                    atk: value,
                    abilityGrade: action === 'ABILITY' ? grade : null
                }
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
                method: 'POST',
                body: {
                    action: preview.action,
                    atk: preview.atk,
                    abilityGrade: preview.abilityGrade,
                    roll: preview.roll,
                    damage: preview.damage,
                    version: preview.version,
                    requestKey: crypto.randomUUID()
                }
            });

            setBoss(result.boss);
            setPreview(null);
            setSelectedId(null);
            setAtk('');
            setAction('ATTACK');
            setGrade('E');

            setNotice(
                '데미지 ' + result.appliedDamage +
                ' 적용 완료. 다음 참가자를 선택하거나 ATK를 입력하세요.'
            );
        });
    }

    return (
        <div className="raid-helper">
            <p className="raid-helper-note">
                운영진용 수동 레이드 계산기입니다. 참가자는 직접 등록하여 선택할 수 있으며,
                캐릭터 자동 조회와 행동 제출, 턴 관리는 포함되지 않습니다.
            </p>

            {!loaded && <p role="status">레이드 보스 정보를 불러오는 중입니다.</p>}

            {error && (
                <p role="alert">
                    {error}
                    <button type="button" disabled={busy} onClick={load}>상태 다시 불러오기</button>
                </p>
            )}

            {storageError && <p role="alert">{storageError}</p>}
            {notice && <p role="status">{notice}</p>}

            <section className="raid-helper-card">
                <h3>보스 상태</h3>

                {boss ? (
                    <div className="raid-helper-hp">
                        <strong>
                            {boss.currentHp.toLocaleString()} / {boss.maxHp.toLocaleString()} HP
                        </strong>

                        <div className="raid-helper-hp-track">
                            <span style={{
                                width: Math.max(0, Math.min(100, boss.currentHp / boss.maxHp * 100)) + '%'
                            }}/>
                        </div>

                        <p>보스 DEF: {boss.def.toLocaleString()}</p>
                    </div>
                ) : (
                    <p>보스 정보를 먼저 설정해 주세요.</p>
                )}

                <details className="raid-helper-settings" open={!boss}>
                    <summary>보스 HP · DEF 설정 / 초기화</summary>

                    <form className="raid-helper-form" onSubmit={resetBoss}>
                        <label>
                            최대 HP
                            <input type="number" min="1" max="2147483647" step="1" value={maxHp} disabled={busy} onChange={e => setMaxHp(e.target.value)}/>
                        </label>

                        <label>
                            보스 DEF
                            <input type="number" min="0" max="1000000" step="1" value={bossDef} disabled={busy} onChange={e => setBossDef(e.target.value)}/>
                        </label>

                        <button type="submit" disabled={busy}>
                            {boss ? '보스 HP 초기화 및 설정' : '보스 설정하기'}
                        </button>
                    </form>

                    <small>기존 보스 HP를 덮어쓰므로 레이드 시작 전 또는 새 레이드에서만 사용하세요.</small>
                </details>
            </section>

            <section className="raid-helper-card">
                <div className="raid-helper-heading">
                    <h3>참가자 관리</h3>
                    <span>등록 {participants.length}명</span>
                </div>

                <p className="raid-helper-description">
                    레이드 참가자의 능력치를 미리 입력하고 저장할 수 있습니다.
                    참가자를 선택하면 등록된 ATK와 이능 정보가 계산기에 입력됩니다.
                </p>

                <div className="raid-helper-participant-list">
                    {participants.length === 0 ? (
                        <p className="raid-helper-empty">등록된 참가자가 없습니다.</p>
                    ) : participants.map(person => (
                        <div className="raid-helper-participant" key={person.id}>
                            <button
                                type="button"
                                className={'raid-helper-participant-select' + (selectedId === person.id ? ' selected' : '')}
                                aria-pressed={selectedId === person.id}
                                disabled={busy}
                                onClick={() => selectParticipant(person.id)}
                            >
                                <strong>{person.name}</strong>
                                <span>ATK {person.atk} / DEF {person.def} / AGI {person.agi}</span>
                                <small>
                                    {person.hasAbility ? '이능 ' + person.abilityGrade + '급' : '이능 없음'}
                                </small>
                            </button>

                            <div className="raid-helper-participant-actions">
                                <button type="button" disabled={busy} onClick={() => editParticipant(person)}>수정</button>
                                <button type="button" disabled={busy} onClick={() => deleteParticipant(person)}>삭제</button>
                            </div>
                        </div>
                    ))}
                </div>

                <form className="raid-helper-participant-form" onSubmit={saveParticipant}>
                    <h4>{editingId ? '참가자 수정' : '참가자 등록'}</h4>

                    <div className="raid-helper-participant-fields">
                        <label className="raid-helper-name-field">
                            캐릭터 이름
                            <input type="text" maxLength="40" required value={draft.name} disabled={busy} onChange={e => changeDraft('name', e.target.value)} placeholder="캐릭터 이름"/>
                        </label>

                        <label>
                            ATK
                            <input type="number" min="0" max="1000000" step="1" required value={draft.atk} disabled={busy} onChange={e => changeDraft('atk', e.target.value)}/>
                        </label>

                        <label>
                            DEF
                            <input type="number" min="0" max="1000000" step="1" required value={draft.def} disabled={busy} onChange={e => changeDraft('def', e.target.value)}/>
                        </label>

                        <label>
                            AGI
                            <input type="number" min="0" max="1000000" step="1" required value={draft.agi} disabled={busy} onChange={e => changeDraft('agi', e.target.value)}/>
                        </label>

                        <label className="raid-helper-ability-check">
                            <input type="checkbox" checked={draft.hasAbility} disabled={busy} onChange={e => changeDraft('hasAbility', e.target.checked)}/>
                            이능 보유
                        </label>

                        {draft.hasAbility && (
                            <label>
                                이능 등급
                                <select value={draft.abilityGrade} disabled={busy} onChange={e => changeDraft('abilityGrade', e.target.value)}>
                                    {gradeOptions.map(value => (
                                        <option value={value} key={value}>{value}급</option>
                                    ))}
                                </select>
                            </label>
                        )}
                    </div>

                    <div className="raid-helper-form-actions">
                        <button type="submit" disabled={busy}>
                            {editingId ? '수정 저장' : '참가자 등록'}
                        </button>

                        {editingId && (
                            <button type="button" disabled={busy} onClick={clearDraft}>수정 취소</button>
                        )}
                    </div>
                </form>
            </section>

            <section className="raid-helper-card">
                <h3>공격 데미지 계산</h3>

                <div className="raid-helper-selected">
                    {selectedParticipant ? (
                        <>
                            <div>
                                <strong>{selectedParticipant.name}</strong>
                                <span>
                                    ATK {selectedParticipant.atk} · DEF {selectedParticipant.def} · AGI {selectedParticipant.agi}
                                </span>
                                <small>
                                    {selectedParticipant.hasAbility
                                        ? '이능 ' + selectedParticipant.abilityGrade + '급'
                                        : '이능 없음'}
                                </small>
                            </div>

                            <button type="button" disabled={busy} onClick={() => selectParticipant(null)}>
                                선택 해제
                            </button>
                        </>
                    ) : (
                        <p>참가자를 선택하거나 아래에서 ATK를 직접 입력해 주세요.</p>
                    )}
                </div>

                <form className="raid-helper-form" onSubmit={calculate}>
                    <label>
                        공격 유형
                        <select value={action} disabled={busy || !boss} onChange={e => change(setAction, e.target.value)}>
                            <option value="ATTACK">일반공격</option>
                            <option value="ABILITY" disabled={!canUseAbility}>이능공격</option>
                        </select>
                    </label>

                    <label>
                        참가자 ATK
                        <input type="number" min="0" max="1000000" step="1" value={atk} disabled={busy || !boss} onChange={e => change(setAtk, e.target.value)} placeholder="ATK"/>
                    </label>

                    {action === 'ABILITY' && (
                        <label>
                            이능 등급
                            <select value={grade} disabled={busy || !boss || !!selectedParticipant} onChange={e => change(setGrade, e.target.value)}>
                                {gradeOptions.map(value => (
                                    <option value={value} key={value}>{value}급</option>
                                ))}
                            </select>
                        </label>
                    )}

                    <button type="submit" disabled={busy || !boss || boss.currentHp <= 0}>
                        데미지 계산하기
                    </button>
                </form>

                <small>
                    기존 일반 PVE 공격식과 서버 이능 배율을 사용합니다.
                    DEF와 AGI는 참가자 정보로 보관하며, 이 계산기에서 캐릭터 AP는 자동 차감되지 않습니다.
                </small>

                {preview && (
                    <div className="raid-helper-preview">
                        <div>
                            <span>계산된 데미지</span>
                            <strong>{preview.damage.toLocaleString()}</strong>
                        </div>

                        <p>
                            공격 난수: {preview.roll} / 유형: {preview.action === 'ABILITY'
                            ? '이능공격 ' + preview.abilityGrade + '급'
                            : '일반공격'}
                        </p>

                        <p>
                            예상 보스 HP: {Math.max(0, boss.currentHp - preview.damage).toLocaleString()}
                        </p>

                        <button type="button" disabled={busy} onClick={apply}>
                            이 데미지를 보스 HP에 적용
                        </button>
                    </div>
                )}
            </section>
        </div>
    );
}