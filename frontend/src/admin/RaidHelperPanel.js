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
