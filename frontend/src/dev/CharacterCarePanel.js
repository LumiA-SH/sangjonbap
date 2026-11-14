import {useRef, useState} from 'react';
import {api} from '../api/client';
import CharacterSearch from './CharacterSearch';

export function validCharacterId(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) &&
      (value.length < 19 || value <= '9223372036854775807');
}

export default function CharacterCarePanel({character, busy, run, refresh, notify}) {
  const [confirmation, setConfirmation] = useState(null);
  const [target, setTarget] = useState(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);
  const sending = useRef(false);

  const disabled = busy || pending || !character || character.in_active_battle || character.status !== 'ALIVE';
  const validTarget = validCharacterId(String(target?.id || ''));

  function selectTarget(id, row) {
    setTarget({id: String(id), name: row?.name || '이름 확인 필요'});
    setConfirmation(null);
    setFailure(null);
  }

  function clearTarget() {
    setTarget(null);
    setConfirmation(null);
    setFailure(null);
  }

  async function preview(action, id) {
    if (sending.current || disabled || !validCharacterId(id)) return;

    sending.current = true;
    setPending(true);
    setFailure(null);
    setConfirmation(null);

    try {
      setConfirmation(await api(`/characters/${id}/care-preview?action=${action}`));
    } catch (error) {
      setFailure({code: error.code || 'PREVIEW_FAILED', message: error.message});
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  async function perform(action, id) {
    if (sending.current || disabled || !validCharacterId(id) || !confirmation) return;

    sending.current = true;
    setConfirmation(null);
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

          try {
            await refresh();
          } catch {}

          notify(`${error.code || 'NETWORK_ERROR'}: ${error.message}`);
          return;
        }

        // 변경 전 값은 감사 로그를 사용한다.
        let before = null;
        let logError = null;

        try {
          const {records: logs} = await api(`/records/action-logs?requestKey=${encodeURIComponent(requestKey)}`);
          before = logs.find(log => log.request_key?.toLowerCase() === requestKey.toLowerCase())?.detail?.before || null;
        } catch (error) {
          logError = `${error.code || 'LOG_READ_ERROR'}: ${error.message}`;
        }

        setResult({action, requestKey, before, after: data, logError});

        let synced = false;

        try {
          synced = await refresh();
        } catch {
          // 실행 성공 결과는 그대로 유지한다.
        }

        notify(`${action === 'heal' ? '치료' : '부활'} 성공${synced ? ' · 상태 갱신 완료' : ' · 일부 상태 갱신 실패, 새로고침 필요'}`);
      });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
      <section className="survival-care-panel" aria-labelledby="care-title">
        <h2 id="care-title">치료·부활</h2>
        <p>혈량을 소비하여 캐릭터를 치료하거나 부활시킬 수 있습니다. 대상 상태와 행동 가능 여부는 서버에서 검증합니다.</p>

        <button type="button" disabled={disabled} onClick={() => preview('heal', String(character.id))}>
          자기 치료
        </button>

        <div className="survival-care-target-search">
          <CharacterSearch
              inputId="care-target-search"
              label="치료·부활 대상 캐릭터 이름 검색"
              busy={busy || pending}
              onSelect={selectTarget}
              onQueryChange={clearTarget}
              collapseOnSelect
              action={
                <>
                  <button type="button" disabled={disabled || !validTarget} onClick={() => preview('heal', target.id)}>
                    대상 치료
                  </button>
                  <button type="button" disabled={disabled || !validTarget} onClick={() => preview('revive', target.id)}>
                    대상 부활
                  </button>
                </>
              }
          />

          {target && (
              <div className="survival-care-selected-target">
                <span>선택한 대상: <strong>{target.name}</strong><small> ID {target.id}</small></span>
                <button type="button" disabled={busy || pending} onClick={clearTarget}>선택 해제</button>
              </div>
          )}
        </div>

        {pending && <p role="status">처리 중…</p>}

        {confirmation && (
            <div role="group" aria-label="치료 부활 최종 확인">
              <h3>{confirmation.action === 'heal' ? '치료' : '부활'} 확인 — {confirmation.target.name}</h3>
              <p>시전자 혈량 소비: {confirmation.cost} · 예상 혈량: {confirmation.provider.blood} → {confirmation.expected.providerBlood}</p>
              {confirmation.action === 'heal' && <p>대상 HP 회복: {confirmation.hpRecovery}</p>}
              <p>대상 예상 HP: {confirmation.target.hp} → {confirmation.expected.targetHp} · 혈량: {confirmation.expected.targetBlood}</p>
              <p>대상 AP: {confirmation.expected.targetAp} (기존 잔여값 유지)</p>
              <p>예상 수치는 안내용이며 실제 상태와 설정은 서버에서 다시 확인합니다.</p>

              <div className="survival-care-confirm-actions">
                <button type="button" disabled={disabled} onClick={() => perform(confirmation.action, String(confirmation.target.id))}>
                  실행 확인
                </button>
                <button type="button" disabled={pending} onClick={() => setConfirmation(null)}>취소</button>
              </div>
            </div>
        )}

        {failure && (
            <div role="alert">
              <strong>{failure.code}</strong>: {failure.message}
              {failure.requestKey && <p>requestKey: {failure.requestKey}</p>}
            </div>
        )}

        {result && (
            <div className="dev-result" aria-label="치료 부활 결과">
              <h3>{result.action === 'heal' ? '치료' : '부활'} 성공</h3>
              <p>requestKey: {result.requestKey}</p>
              {result.logError && <p role="alert">실행은 성공했지만 변경 전 로그 조회 실패: {result.logError}</p>}

              <div className="care-states">
                {['provider', 'target'].map(role => (
                    <div key={role}>
                      <h4>{role === 'provider' ? '제공자' : '대상'} 변경 전 — 서버 로그</h4>
                      <pre>{result.before?.[role] ? JSON.stringify(result.before[role], null, 2) : '변경 전 로그를 확인할 수 없습니다.'}</pre>
                      <h4>변경 후 — API 응답</h4>
                      <pre>{JSON.stringify(result.after[role], null, 2)}</pre>
                    </div>
                ))}
              </div>
            </div>
        )}
      </section>
  );
}