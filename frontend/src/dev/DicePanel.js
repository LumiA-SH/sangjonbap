import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import './DicePanel.css';

function postMessage(status) {
    if (status === 'SENT') return '마스토돈 게시 완료';
    if (status === 'PENDING') return '마스토돈 게시 대기 중';
    if (status === 'FAILED') return '마스토돈 게시 실패';
    return '마스토돈 게시 미확인';
}

export default function DicePanel({expanded = false}) {
    const [roll, setRoll] = useState(null);
    const [loading, setLoading] = useState(true);
    const [rolling, setRolling] = useState(false);
    const [error, setError] = useState('');
    const [history, setHistory] = useState([]);
    const [historyBefore, setHistoryBefore] = useState(null);
    const [historyBusy, setHistoryBusy] = useState(false);
    const [historyError, setHistoryError] = useState('');
    const historyPending = useRef(false);
    const historyMounted = useRef(false);
    const pending = useRef(false);
    const requestKey = useRef(null);

    useEffect(() => {
        let active = true;

        api('/dice/latest')
            .then(data => {
                if (active) setRoll(data.roll);
            })
            .catch(e => {
                if (active) setError(`${e.code || 'DICE_FAILED'}: ${e.message}`);
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {active = false;};
    }, []);

    async function loadHistory(before = null) {
        if (historyPending.current) return;
        historyPending.current = true;
        setHistoryBusy(true);
        setHistoryError('');
        try {
            const data = await api('/records/action-logs' + (before ? '?before=' + encodeURIComponent(before) : ''));
            if (!historyMounted.current) return;
            const rows = data.records.filter(row => row.action_type === 'DICE_ROLL').map(row => ({
                id: String(row.id), result: row.detail?.result, createdAt: row.created_at
            }));
            setHistory(current => Array.from(new Map([...current, ...rows].map(row => [String(row.id), row])).values())
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || String(b.id).localeCompare(String(a.id), 'en', {numeric: true})));
            setHistoryBefore(data.nextBefore);
        } catch (e) {
            if (historyMounted.current) setHistoryError(e.message || '이전 기록을 불러오지 못했습니다.');
        } finally {
            historyPending.current = false;
            if (historyMounted.current) setHistoryBusy(false);
        }
    }

    useEffect(() => {
        historyMounted.current = expanded;
        if (expanded) loadHistory();
        return () => {historyMounted.current = false;};
    }, [expanded]);

    async function throwDice() {
        if (pending.current || loading) return;

        pending.current = true;
        setRolling(true);
        setError('');

        const key = requestKey.current || crypto.randomUUID();
        requestKey.current = key;

        try {
            const data = await api('/dice/roll', {
                method: 'POST',
                body: {requestKey: key}
            });

            setRoll(data.roll);
            requestKey.current = null;
        } catch (e) {
            setError(`${e.code || 'DICE_FAILED'}: ${e.message}`);
        } finally {
            pending.current = false;
            setRolling(false);
        }
    }

    return (
        <div className={`dice-panel${expanded ? ' dice-panel-expanded' : ''}`} aria-label="1D100 주사위">
            <div className="dice-panel-main">
                <div className="dice-panel-label">
                    <strong>1D100 다이스</strong>
                    <small>횟수 제한 없음 · 자원 소모 없음</small>
                    {expanded && <p>1부터 100까지의 숫자 중 하나가 나옵니다. 굴린 결과와 게시 상태를 아래에서 확인하세요.</p>}
                </div>

                <div className="dice-panel-result" aria-live="polite">
                    <span>최근 결과</span>
                    <strong>{roll?.result ?? '—'}</strong>
                </div>

                <button type="button" aria-label="1D100 주사위 굴리기" disabled={loading || rolling} onClick={throwDice}>
                    {rolling ? '굴리는 중…' : '굴리기'}
                </button>
            </div>

            {roll && (
                <p className="dice-panel-status">
                    {roll.createdAt && new Date(roll.createdAt).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'})}
                    {' · '}{postMessage(roll.postStatus)}
                </p>
            )}

            {expanded && !loading && !roll && !error && <p className="dice-panel-message">아직 주사위 기록이 없습니다. 첫 주사위를 굴려보세요.</p>}
            {loading && <p className="dice-panel-message" role="status">최근 결과 확인 중…</p>}
            {error && <p className="dice-panel-error" role="alert">{error}</p>}
            {expanded && (
                <section className="dice-history" aria-label="이전 주사위 결과">
                    <h2>이전 주사위 결과</h2>
                    <p>본인의 기록을 최신순으로 표시합니다.</p>
                    <ol>
                        {history.map(row => (
                            <li key={row.id}>
                                <span>1D100</span>
                                <strong>{row.result}</strong>
                                <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'})}</time>
                            </li>
                        ))}
                    </ol>
                    {!history.length && !historyBusy && !historyError && <p>{historyBefore ? '불러온 행동 기록에 주사위 결과가 없습니다. 이전 기록을 더 불러올 수 있습니다.' : '저장된 주사위 결과가 없습니다.'}</p>}
                    {historyBusy && <p role="status">이전 기록을 불러오는 중…</p>}
                    {historyError && <p role="alert">{historyError}</p>}
                    {(historyBefore || historyError) && <button type="button" disabled={historyBusy} onClick={() => loadHistory(historyBefore)}>{historyError ? '기록 다시 불러오기' : '이전 기록 더 불러오기'}</button>}
                </section>
            )}
        </div>
    );
}