import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import './InvestigationPanel.css';

export function rewardText(reward) {
  return reward.recipeId != null
      ? `${reward.name} · 레시피 최초 발견 · 무료 습득 · 상점 등록`
      : `${reward.name} × ${reward.quantity} · 지급 후 보유 ${reward.inventoryQuantity}`;
}

function rateText(value) {
  const number = Number(value);
  return value != null && Number.isFinite(number) ? `${number}%` : '확인 필요';
}

function progressValue(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function AreaImage({area, className = ''}) {
  const url = area?.image_url;
  const safe = typeof url === 'string' && /^(https?:\/\/|\/(?!\/))/.test(url);

  if (!safe) return null;

  return <img key={`${area.id}:${url}`} src={url} className={className} alt="" loading="lazy" onError={e => {e.currentTarget.hidden = true;}}/>;
}

export default function InvestigationPanel({
                                             activeBattle, battleError, areas = [], globalInvestigationRate, investigationApCost,
                                             character, error, characterError, busy, run, refresh, notify
                                           }) {
  const [selectedId, setSelectedId] = useState(null);
  const [latest, setLatest] = useState(null);
  const [uncertain, setUncertain] = useState(null);
  const pending = useRef(null);
  const sending = useRef(false);

  const selectedArea = areas.find(area => String(area.id) === selectedId) || areas[0] || null;
  const costReady = Number.isSafeInteger(investigationApCost) && investigationApCost >= 0;
  const insufficientAp = costReady && character && Number(character.ap) < investigationApCost;
  const blocked = !costReady || !character || ['DEAD', 'NEAR_DEATH'].includes(character.status) ||
      activeBattle || !!battleError || insufficientAp || !!error || !!characterError;
  const pendingOtherArea = pending.current && selectedArea &&
      String(pending.current.area.id) !== String(selectedArea.id);
  const canInvestigate = !busy && !blocked && !!selectedArea?.is_open && !pendingOtherArea;

  async function investigate(area) {
    if (sending.current) return;
    if (pending.current && pending.current.characterId !== character?.id) {
      notify('이전 캐릭터의 미확인 조사 기록을 먼저 확인하세요.');
      return;
    }
    if (pending.current && pending.current.area.id !== area.id) {
      notify('이전 지역의 미확인 조사를 먼저 확인하세요.');
      return;
    }

    sending.current = true;
    const attempt = pending.current || {requestKey: crypto.randomUUID(), area, characterId: character?.id};
    const retry = !!pending.current;
    pending.current = attempt;
    setLatest(null);

    const {requestKey} = attempt;
    let checking = retry;

    try {
      if (retry) {
        const {records} = await api(`/records/action-logs?requestKey=${requestKey}`);
        const log = records.find(row => row.request_key === requestKey && row.action_type === 'INVESTIGATE');

        if (log) {
          pending.current = null;
          setUncertain(null);
          await refresh();
          notify(`조사 완료 기록 확인 · 재실행하지 않았습니다. requestKey: ${requestKey}`);
          return;
        }
      }

      checking = false;
      const data = await api(`/investigation/${area.id}`, {method: 'POST', body: {requestKey}});
      pending.current = null;
      setUncertain(null);
      setLatest({data, requestKey, areaName: area.name});

      const synced = await refresh();
      notify(synced ? '조사 완료 · 캐릭터·지역·인벤토리 상태 동기화 완료' : '조사는 완료됐지만 일부 상태 조회에 실패했습니다. 패널 오류 확인 후 새로고침하세요.');
    } catch (error) {
      if (error.code === 'DUPLICATE_REQUEST') {
        pending.current = null;
        setUncertain(null);
        await refresh();
        notify(`이미 처리된 조사입니다. 기록을 확인하세요. requestKey: ${requestKey}`);
        return;
      }

      if (pending.current) {
        if (!retry && !checking && error.status >= 400 && error.status < 500 && error.code !== 'API_RESPONSE_INVALID') {
          pending.current = null;
          setUncertain(null);
        } else {
          setUncertain(attempt);
        }
      }

      throw error;
    } finally {
      sending.current = false;
    }
  }

  const restriction = activeBattle ? '진행 중인 전투를 종료해야 탐사할 수 있습니다.'
      : battleError ? '전투 상태를 확인할 수 없습니다.'
          : character?.status === 'DEAD' ? '사망 상태에서는 탐사할 수 없습니다.'
              : character?.status === 'NEAR_DEATH' ? '빈사 상태에서는 지역 조회만 가능합니다.'
                  : insufficientAp ? '조사에 필요한 AP가 부족합니다.'
                      : !costReady ? '조사 AP 비용을 불러오지 못했습니다.'
                          : error || characterError ? '정보를 정상적으로 불러온 뒤 탐사할 수 있습니다.'
                              : !selectedArea?.is_open ? '현재 탐사할 수 없는 지역입니다.'
                                  : pendingOtherArea ? '이전 지역의 미확인 조사부터 확인해야 합니다.'
                                      : '';

  const resultRef = useRef(null);
  const result = latest?.data;
  useEffect(() => {
    if (result) resultRef.current?.focus({preventScroll: true});
  }, [result]);
  const rewards = result?.rewards || [];

  return (
      <section className="survival-expedition" aria-labelledby="investigation-title">
        <header className="expedition-header">
          <div className="expedition-heading">
            <span className="expedition-eyebrow">FIELD OPERATIONS / EXPLORATION</span>
            <h2 id="investigation-title">탐사 터미널</h2>
            <p>지역을 선택하고 주변을 탐색하세요. 무엇을 발견할지는 조사 결과에 따라 달라집니다.</p>
          </div>

          <div className="expedition-overview">
            <div>
              <small>서버 전체 조사율</small>
              <strong>{rateText(globalInvestigationRate)}</strong>
            </div>
            <div>
              <small>현재 AP</small>
              <strong>{character?.ap ?? '—'}</strong>
            </div>
          </div>
        </header>

        <div className="expedition-toolbar">
          <span>탐사 가능 지역 <strong>{areas.length}</strong>곳</span>
          <span>최초 발견 정보는 모든 캐릭터가 공유합니다.</span>
          <button type="button" disabled={busy} onClick={() => run(refresh)}>지역 새로고침</button>
        </div>

        {error && <p className="expedition-notice is-error" role="alert">지역 조회 실패: {error} · 이전 표시값일 수 있습니다.</p>}
        {characterError && <p className="expedition-notice is-error" role="alert">캐릭터 상태 조회 실패: {characterError}</p>}
        {battleError && <p className="expedition-notice is-error" role="alert">전투 상태 확인 실패: {battleError}</p>}

        {uncertain && (
            <div className="expedition-notice is-warning" role="status">
              <div>
                <strong>미확인 탐사 기록</strong>
                <p>{uncertain.area.name}에서 실행한 조사의 처리 여부를 확인해야 합니다. 같은 요청 식별자를 사용해 안전하게 재확인합니다.</p>
              </div>
              <button type="button" disabled={busy} onClick={() => run(() => investigate(uncertain.area))}>기록 확인 및 같은 요청 재시도</button>
            </div>
        )}

        <div className="expedition-board">
          <aside className="expedition-regions" aria-label="탐사 지역 선택">
            <div className="expedition-regions-heading">
              <span>AREA SELECT</span>
              <strong>탐사 지역</strong>
            </div>

            <div className="expedition-region-list">
              {areas.map((area, index) => (
                  <button key={area.id} type="button" className={`expedition-region${String(selectedArea?.id) === String(area.id) ? ' is-selected' : ''}`} aria-pressed={String(selectedArea?.id) === String(area.id)} onClick={() => setSelectedId(String(area.id))}>
                    <div className="expedition-region-image">
                      <AreaImage area={area}/>
                    </div>
                    <div className="expedition-region-info">
                      <small>ZONE {String(index + 1).padStart(2, '0')}</small>
                      <strong>{area.name}</strong>
                      <span>조사 진행률 {rateText(area.investigation_rate)}</span>
                      <div className="expedition-mini-progress"><span style={{width: `${progressValue(area.investigation_rate)}%`}}/></div>
                    </div>
                    <span className="expedition-region-arrow" aria-hidden="true">›</span>
                  </button>
              ))}

              {!error && areas.length === 0 && (
                  <div className="expedition-empty-region">현재 접근 가능한 탐사 지역이 없습니다.</div>
              )}
            </div>

            <div className="expedition-regions-foot">DISCOVER THE UNKNOWN</div>
          </aside>

          <div className="expedition-main">
            {selectedArea ? (
                <>
                  <div className="expedition-scene">
                    <AreaImage area={selectedArea} className="expedition-scene-image"/>
                    <div className="expedition-scene-grid" aria-hidden="true"/>
                    <div className="expedition-scene-top">
                      <span>EXPLORATION ZONE</span>
                      <span>{selectedArea.is_open ? 'ACCESS GRANTED' : 'LOCKED'}</span>
                    </div>
                    <div className="expedition-scene-content">
                      <h3>{selectedArea.name}</h3>
                      <p>{selectedArea.description || '지역에 대한 상세 정보가 등록되지 않았습니다.'}</p>
                    </div>
                  </div>

                  <div className="expedition-mission">
                    <div className="expedition-mission-title">
                      <div>
                        <span>MISSION STATUS</span>
                        <h3>지역 탐사 현황</h3>
                      </div>
                      <strong>{rateText(selectedArea.investigation_rate)}</strong>
                    </div>

                    <div className="expedition-progress-track" role="progressbar" aria-label={`${selectedArea.name} 조사 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue(selectedArea.investigation_rate)}>
                      <span style={{width: `${progressValue(selectedArea.investigation_rate)}%`}}/>
                    </div>

                    <div className="expedition-mission-stats">
                      <div><small>조사 AP 비용</small><strong>{costReady ? investigationApCost : '—'}</strong></div>
                      <div><small>탐사 후 남은 AP</small><strong>{costReady && character ? Math.max(0, Number(character.ap) - investigationApCost) : '—'}</strong></div>
                    </div>

                    <div className="expedition-mission-action">
                      <div>
                        <strong>탐사를 시작하시겠습니까?</strong>
                        <small>조사 결과와 보상 판정 후 별도로 마물 조우를 판정합니다.</small>
                      </div>
                      <button type="button" className="expedition-start" disabled={!canInvestigate} onClick={() => run(() => investigate(selectedArea))}>
                        {busy ? '탐사 처리 중…' : '탐사 시작'}
                        <span aria-hidden="true">→</span>
                      </button>
                    </div>

                    {restriction && <p className="expedition-restriction" role="status">{restriction}</p>}

                    {result?.battle && activeBattle && (
                        <div className="expedition-encounter" role="alert">
                          <div>
                            <strong>마물 조우 발생!</strong>
                            <p>탐사 중 마물과 조우했습니다. 전투가 시작되었습니다.</p>
                          </div>
                          <a href="#game/battle">전투 화면으로 이동 →</a>
                        </div>
                    )}
                  </div>
                </>
            ) : (
                <div className="expedition-no-selection">
                  <span>NO LOCATION SELECTED</span>
                  <strong>탐사할 지역이 없습니다.</strong>
                  <p>지역이 공개되면 이곳에서 조사할 수 있습니다.</p>
                </div>
            )}
          </div>
        </div>



        {result && (
            <section ref={resultRef} tabIndex={-1} className="expedition-report" aria-label="최근 조사 결과" aria-live="polite">
              <header className="expedition-report-heading">
                <div>
                  <span>EXPLORATION REPORT</span>
                  <h3>탐사 보고서</h3>
                  <p>{latest.areaName} · 조사 완료</p>
                </div>
                <span className="expedition-report-seal">COMPLETE</span>
              </header>

              <div className="expedition-report-story">
                <small>FIELD RECORD</small>
                <p>{result.result.result_text}</p>
                {result.firstDiscovery && <strong>새로운 최초 발견 기록이 등록되었습니다.</strong>}
              </div>

              <div className="expedition-report-facts">
                <span>조사 진행률 <strong>{rateText(result.area.investigation_rate)}</strong></span>
                <span>잔여 AP <strong>{result.ap}</strong></span>
                <span>고유 결과 <strong>{result.result.is_unique ? '예' : '아니오'}</strong></span>
              </div>

              <div className="expedition-report-grid">
                <section>
                  <h4>획득 보상</h4>
                  {rewards.length ? (
                      <ul>{rewards.map((reward, index) => <li key={`${reward.rewardId ?? reward.recipeId ?? index}`}>{rewardText(reward)}</li>)}</ul>
                  ) : <p>이번 조사에서 지급된 보상이 없습니다.</p>}
                </section>

                <section>
                  <h4>관련 단서</h4>
                  {result.clue ? (
                      <>
                        <strong>{result.clue.title}</strong>
                        <p className="expedition-clue-content">{result.clue.content}</p>
                        {result.clue.related_target && <small>관련 대상: {result.clue.related_target}</small>}
                      </>
                  ) : <p>이번 조사에서 공개된 단서가 없습니다.</p>}
                </section>
              </div>

              <details className="expedition-technical">
                <summary>조사 응답 기록 및 requestKey</summary>
                <pre>{JSON.stringify(latest, null, 2)}</pre>
              </details>
            </section>
        )}
      </section>
  );
}