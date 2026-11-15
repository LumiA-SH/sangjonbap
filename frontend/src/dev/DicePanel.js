import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import './DicePanel.css';

function postMessage(status) {
    if (status === 'SENT') return '마스토돈 게시 완료';
    if (status === 'PENDING') return '마스토돈 게시 대기 중';
    if (status === 'FAILED') return '마스토돈 게시 실패';
    return '마스토돈 게시 미확인';
}

export default function DicePanel() {
    const [roll, setRoll] = useState(null);
    const [loading, setLoading] = useState(true);
    const [rolling, setRolling] = useState(false);
    const [error, setError] = useState('');
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
        <div className="dice-panel" aria-label="1D100 주사위">
            <div className="dice-panel-main">
                <div className="dice-panel-label">
                    <strong>1D100 다이스</strong>
                    <small>횟수 제한 없음 · 자원 소모 없음</small>
                </div>

                <div className="dice-panel-result" aria-live="polite">
                    <span>최근 결과</span>
                    <strong>{roll?.result ?? '—'}</strong>
                </div>

                <button type="button" disabled={loading || rolling} onClick={throwDice}>
                    {rolling ? '굴리는 중…' : '굴리기'}
                </button>
            </div>

            {roll && (
                <p className="dice-panel-status">
                    {roll.createdAt && new Date(roll.createdAt).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'})}
                    {' · '}{postMessage(roll.postStatus)}
                </p>
            )}

            {loading && <p className="dice-panel-message" role="status">최근 결과 확인 중…</p>}
            {error && <p className="dice-panel-error" role="alert">{error}</p>}
        </div>
    );
}