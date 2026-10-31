import {useRef, useState} from 'react';
import {api} from '../api/client';
import CharacterSearch from './CharacterSearch';

export function validCharacterId(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) &&
    (value.length < 19 || value <= '9223372036854775807');
}

export default function CharacterCarePanel({character, busy, run, refresh, notify}) {
  const [targetId, setTargetId] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);
  const sending = useRef(false);
  const disabled = busy || pending || !character;

  async function perform(action, id) {
    if (sending.current || disabled || !validCharacterId(id)) return;
    sending.current = true;
    setPending(true);
    try {
      await run(async () => {
        setResult(null);
        setFailure(null);
        const requestKey = crypto.randomUUID();
        let data;
        try {
          data = await api(`/characters/${id}/${action}`, {method: 'POST', body: {requestKey}});
        } catch (error) {
          setFailure({code: error.code || 'NETWORK_ERROR', message: error.message, requestKey});
          notify(`${error.code || 'NETWORK_ERROR'}: ${error.message}`);
          return;
        }
        // Before values come from the transaction's audit log, never arithmetic
        // or an unrelated target lookup. A failed log read is not a failed action.
        let before = null;
        let logError = null;
        try {
          const {logs} = await api(`/dev/action-logs?requestKey=${encodeURIComponent(requestKey)}`);
          before = logs.find(log => log.request_key?.toLowerCase() === requestKey.toLowerCase())?.detail?.before || null;
        } catch (error) { logError = `${error.code || 'LOG_READ_ERROR'}: ${error.message}`; }
        setResult({action, requestKey, before, after: data, logError});
        let synced = false;
        try { synced = await refresh(); } catch { /* Keep committed action result visible. */ }
        notify(`${action === 'heal' ? '치료' : '부활'} 성공${synced ? ' · 상태 갱신 완료' : ' · 일부 상태 갱신 실패, 새로고침 필요'}`);
      });
    } finally { sending.current = false; setPending(false); }
  }

  return <section aria-labelledby="care-title">
    <span className="badge">CHARACTER CARE</span>
    <h2 id="care-title">치료·부활 DEV</h2>
    <p>본인 캐릭터 ID: {character?.id || '조회 필요'} · 대상 상태와 행동 가능 여부는 서버에서 검증합니다.</p>
    <label htmlFor="care-target">대상 캐릭터 ID</label>
    <input id="care-target" inputMode="numeric" value={targetId} onChange={event => setTargetId(event.target.value)} disabled={busy || pending}/>
    {targetId && !validCharacterId(targetId) && <p role="alert">대상 ID는 양의 정수여야 합니다.</p>}
    <CharacterSearch busy={busy || pending} onSelect={setTargetId}/>
    <div className="actions">
      <button disabled={disabled} onClick={() => perform('heal', String(character.id))}>자기 치료</button>
      <button disabled={disabled || !validCharacterId(targetId)} onClick={() => perform('heal', targetId)}>대상 치료</button>
      <button disabled={disabled || !validCharacterId(targetId)} onClick={() => perform('revive', targetId)}>대상 부활</button>
    </div>
    {failure && <div role="alert"><strong>{failure.code}</strong>: {failure.message}<p>requestKey: {failure.requestKey}</p></div>}
    {result && <div className="dev-result" aria-label="치료 부활 결과">
      <h3>{result.action === 'heal' ? '치료' : '부활'} 성공</h3>
      <p>requestKey: {result.requestKey}</p>
      {result.logError && <p role="alert">실행은 성공했지만 변경 전 로그 조회 실패: {result.logError}</p>}
      <div className="care-states">{['provider', 'target'].map(role => <div key={role}>
        <h4>{role === 'provider' ? '제공자' : '대상'} 변경 전 — 서버 로그</h4>
        <pre>{result.before?.[role] ? JSON.stringify(result.before[role], null, 2) : '변경 전 로그를 확인할 수 없습니다.'}</pre>
        <h4>변경 후 — API 응답</h4><pre>{JSON.stringify(result.after[role], null, 2)}</pre>
      </div>)}</div>
    </div>}
  </section>;
}
