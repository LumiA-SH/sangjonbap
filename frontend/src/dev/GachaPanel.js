import {useRef, useState} from 'react';
import {api} from '../api/client';
import './GachaPanel.css';

const CAPSULE_POSITIONS = [
  [28, 24, -25, 14, -12], [47, 21, 35, -16, 12], [66, 25, -45, 12, 15],
  [19, 40, 40, 17, -14], [37, 39, -15, -14, 18], [56, 38, 55, 17, -15], [77, 41, -30, -15, 14],
  [15, 58, -50, 15, 13], [32, 55, 30, -18, -15], [50, 56, -35, 16, 17], [68, 56, 45, -15, -18], [84, 60, -20, -12, 12],
  [21, 72, 25, 16, -17], [39, 72, -40, -14, 15], [57, 73, 30, 18, -13], [76, 75, -35, -17, 12],
  [31, 86, 35, 15, -16], [49, 86, -25, -18, 13], [67, 86, 45, 15, -14],
  [43, 48, -50, 17, 14], [60, 66, 25, -15, -15], [26, 62, -35, 16, 12],
  [72, 45, 40, -16, 17], [48, 66, -20, 15, -16]
];

const CAPSULE_COLORS = [
  ['#650c13', '#f2efeb'], ['#303034', '#e5e5e5'], ['#a8a8aa', '#f7f5f1'],
  ['#85333b', '#e9d9d9'], ['#68686b', '#dadada'], ['#f2efeb', '#650c13']
];

const ANIMATION_STEPS = [['mixing', 1800], ['dropping', 1000], ['opening', 750]];

function coinText(value) {
  const number = Number(value);
  return value != null && Number.isFinite(number) ? number.toLocaleString('ko-KR') : '—';
}

function dateText(value) {
  if (!value) return '제한 없음';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
}

function periodText(gacha) {
  if (gacha.period_enabled === false) return '상시 운영';
  return `${dateText(gacha.start_at)} ~ ${dateText(gacha.end_at)}`;
}

function gachaStatus(gacha) {
  if (gacha.boundary) return {text: '운영 확인 중', type: 'hold'};
  if (gacha.outside) return {text: '운영 기간 외', type: 'closed'};
  if (gacha.stock_hold) return {text: '재고 준비 중', type: 'hold'};
  if (gacha.sold_out) return {text: '전체 품절', type: 'closed'};
  return {text: '추첨 가능', type: 'available'};
}

function rewardStatus(reward) {
  if (reward.remainingStock == null) return {text: '재고 준비 중', type: 'hold'};
  if (Number(reward.remainingStock) <= 0) return {text: '품절', type: 'closed'};
  return {text: '추첨 대상', type: 'available'};
}

function RewardImage({url, name = '아이템', large = false}) {
  const [failed, setFailed] = useState(false);
  const valid = typeof url === 'string' && /^(https?:\/\/|\/(?!\/))/.test(url);

  return (
      <span className={`gacha-item-image${large ? ' is-large' : ''}`}>
            {valid && !failed
                ? <img src={url} alt={`${name} 이미지`} loading="lazy" onError={() => setFailed(true)}/>
                : <span className="gacha-item-placeholder" aria-hidden="true"/>}
        </span>
  );
}

function Capsule({index}) {
  const [x, y, rotation, dx, dy] = CAPSULE_POSITIONS[index];
  const [top, bottom] = CAPSULE_COLORS[index % CAPSULE_COLORS.length];

  const style = {
    '--x': `${x}%`, '--y': `${y}%`, '--rotation': `${rotation}deg`,
    '--dx': `${dx}px`, '--dy': `${dy}px`, '--delay': `${-index * 0.07}s`,
    '--cap-top': top, '--cap-bottom': bottom
  };

  return (
      <div className="gacha-globe-capsule" style={style}>
        <div className="gacha-mini-capsule">
          <span className="gacha-mini-band"/>
          <span className="gacha-mini-gloss"/>
        </div>
      </div>
  );
}

function GachaMachine({phase}) {
  const messages = {
    idle: 'READY TO DRAW',
    processing: '추첨 요청 처리 중...',
    mixing: '두두두두... 캡슐을 섞는 중!',
    dropping: '덜컹! 캡슐 배출 중!',
    opening: '캡슐 개봉 중...',
    complete: 'DRAW COMPLETE!'
  };

  return (
      <div className={`gacha-machine is-${phase}`}>
        <div className="gacha-machine-stage">
          <div className="gacha-machine-structure">
            <div className="gacha-machine-globe">
              <div className="gacha-globe-inner">
                <div className="gacha-globe-swirl">
                  {CAPSULE_POSITIONS.map((_, index) => <Capsule key={index} index={index}/>)}
                </div>
              </div>
              <div className="gacha-globe-shine"/>
            </div>
            <div className="gacha-machine-neck"/>
            <div className="gacha-machine-body">
              <div className="gacha-machine-label">SURVIVAL SUPPLY</div>
              <div className="gacha-machine-knob">
                <div className="gacha-knob-center"/>
                <div className="gacha-knob-handle"/>
              </div>
              <div className="gacha-machine-chute"><span/></div>
              <div className="gacha-machine-bottom"/>
            </div>
            <div className="gacha-released-capsule">
              <div className="gacha-release-spark">✦</div>
              <div className="gacha-release-top"/>
              <div className="gacha-release-bottom"/>
              <div className="gacha-release-band"/>
            </div>
          </div>
        </div>
        <div className="gacha-machine-status" role="status" aria-live="polite">
          <span className={`gacha-status-light${!['idle', 'complete'].includes(phase) ? ' is-working' : ''}`}/>
          <strong>{messages[phase]}</strong>
        </div>
      </div>
  );
}

function GachaResult({result, imageUrl}) {
  return (
      <div className="gacha-result" aria-live="polite">
        <div className="gacha-result-heading">
          <span>★ DRAW COMPLETE ★</span>
          <h3>따단! 보상 획득!</h3>
        </div>
        <div className="gacha-result-reward">
          <RewardImage key={imageUrl || 'empty'} url={imageUrl} name={result.reward?.name} large/>
          <div>
            <small>ACQUIRED ITEM</small>
            <strong>{result.reward?.name || '보상 정보 없음'}</strong>
            <span>획득 수량 × {result.reward?.quantity ?? 1}</span>
          </div>
        </div>
        {result.reward?.description && <p className="gacha-result-description">{result.reward.description}</p>}
        <div className="gacha-result-summary">
          <div><span>사용 코인</span><strong>{coinText(result.price)}개</strong></div>
          <div><span>추첨 후 잔액</span><strong>{coinText(result.currency)}개</strong></div>
        </div>
        <p className="gacha-result-notice">획득한 아이템은 인벤토리에서도 확인할 수 있습니다.</p>
        <details>
          <summary>추첨 처리 상세</summary>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </details>
      </div>
  );
}

export default function GachaPanel({gachas = [], character, error, busy, run, refresh, notify}) {
  const [selectedId, setSelectedId] = useState(null);
  const [result, setResult] = useState(null);
  const [recentRewards, setRecentRewards] = useState([]);
  const [failure, setFailure] = useState('');
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [motionEnabled, setMotionEnabled] = useState(() => {
    return typeof window === 'undefined' || !window.matchMedia
        ? true
        : !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  const sending = useRef(false);
  const selectedGacha = gachas.find(item => String(item.id) === selectedId) || gachas[0] || null;
  const rewardList = Array.isArray(selectedGacha?.rewards) ? selectedGacha.rewards : null;
  const currency = Number(character?.currency);
  const insufficientCoins = !Number.isFinite(currency) || currency < 1;

  function drawReason(gacha) {
    if (!gacha) return '추첨할 가챠를 선택해 주세요.';
    if (busy || pending) return '추첨 처리 중입니다.';
    if (error) return '가챠 정보를 다시 불러와 주세요.';
    if (!character) return '캐릭터 정보를 확인할 수 없습니다.';
    if (character.status === 'DEAD') return '사망 상태에서는 가챠를 사용할 수 없습니다.';
    if (character.status === 'NEAR_DEATH') return '빈사 상태에서는 가챠를 사용할 수 없습니다.';
    if (character.in_active_battle) return '전투 중에는 가챠를 사용할 수 없습니다.';
    if (gacha.boundary) return '운영 기간 경계 정책 확인이 필요합니다.';
    if (gacha.outside) return '현재 운영 기간이 아닙니다.';
    if (gacha.stock_hold) return '보상 재고 설정이 완료되지 않았습니다.';
    if (gacha.sold_out) return '모든 보상이 품절되었습니다.';
    if (insufficientCoins) return '코인 1개가 필요합니다.';
    return '';
  }

  function selectGacha(gacha) {
    if (pending || String(selectedGacha?.id) === String(gacha.id)) return;
    setSelectedId(String(gacha.id));
    setResult(null);
    setFailure('');
    setPhase('idle');
  }

  async function draw(gacha) {
    if (sending.current || drawReason(gacha)) return;

    sending.current = true;
    setPending(true);
    setResult(null);
    setFailure('');
    setPhase('processing');

    try {
      await run(async () => {
        let data;
        const requestKey = crypto.randomUUID();

        try {
          data = await api(`/gacha/${gacha.id}/draw`, {
            method: 'POST',
            body: {requestKey}
          });
        } catch (e) {
          setFailure(`${e.code || 'NETWORK_ERROR'}: ${e.message}`);
          setPhase('idle');
          return;
        }

        const rewardInfo = gacha.rewards?.find(item => String(item.itemId) === String(data.reward?.itemId));
        const imageUrl = rewardInfo?.image_url || null;
        let synced = false;

        try {
          synced = await refresh();
        } catch {
          // 추첨은 이미 완료되었으므로 결과를 유지한다.
        }

        if (motionEnabled) {
          for (const [step, duration] of ANIMATION_STEPS) {
            setPhase(step);
            await new Promise(resolve => setTimeout(resolve, duration));
          }
        }

        setResult({...data, rewardImageUrl: imageUrl});
        setRecentRewards(previous => [{
          ...data.reward,
          image_url: imageUrl,
          gachaName: gacha.name,
          drawKey: requestKey
        }, ...previous].slice(0, 16));
        setPhase('complete');

        notify(synced ? '추첨 완료 · 전체 상태 갱신 완료' : '추첨 완료 · 일부 조회 실패, 새로고침 필요');
      });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  const reason = drawReason(selectedGacha);

  return (
      <section className={`survival-gacha${motionEnabled ? '' : ' is-motion-off'}`} aria-labelledby="gacha-title">
        <header className="gacha-header">
          <div>
            <h2 id="gacha-title">보급 추첨</h2>
            <p>캡슐을 뽑아 무작위 RP 아이템을 획득하세요.</p>
          </div>
          <div className="gacha-header-right">
            <div className="gacha-wallet">
              <small>보유 코인</small>
              <strong>{coinText(character?.currency)}</strong>
            </div>
            <button type="button" className="gacha-refresh" disabled={busy || pending} onClick={() => run(refresh)}>목록 새로고침</button>
          </div>
        </header>

        {error && <p className="gacha-notice" role="alert">가챠 조회 실패: {error} · 이전 값일 수 있습니다.</p>}
        {character?.status === 'DEAD' && <p className="gacha-notice">사망 상태에서는 가챠를 사용할 수 없습니다.</p>}
        {character?.status === 'NEAR_DEATH' && <p className="gacha-notice">빈사 상태에서는 가챠를 사용할 수 없습니다.</p>}
        {character?.in_active_battle && <p className="gacha-notice">전투 중에는 가챠를 사용할 수 없습니다.</p>}

        <div className="gacha-layout">
          <aside className="gacha-selector" aria-label="가챠 선택">
            <div className="gacha-section-heading">
              <div>
                <h3>가챠 선택</h3>
                <p>진행할 가챠를 선택하세요.</p>
              </div>
              <span>{gachas.length}종</span>
            </div>

            {gachas.length > 0 ? (
                <div className="gacha-selector-list">
                  {gachas.map(gacha => {
                    const status = gachaStatus(gacha);
                    const selected = String(selectedGacha?.id) === String(gacha.id);

                    return (
                        <button key={gacha.id} type="button" className={`gacha-select-card${selected ? ' is-selected' : ''}`} aria-pressed={selected} disabled={pending} onClick={() => selectGacha(gacha)}>
                          <span className="gacha-select-icon" aria-hidden="true"><span className="gacha-select-capsule"/></span>
                          <span className="gacha-select-info">
                                            <strong>{gacha.name}</strong>
                                            <span className={`gacha-status-tag is-${status.type}`}>{status.text}</span>
                                            <small>{coinText(gacha.price)} 코인 / 1회</small>
                                        </span>
                        </button>
                    );
                  })}
                </div>
            ) : (
                <div className="gacha-selector-empty">현재 활성 가챠가 없습니다.</div>
            )}
          </aside>

          <div className="gacha-main-column">
            <div className="gacha-main">
              <div className="gacha-main-heading">
                <div>
                  <span>CAPSULE MACHINE</span>
                  <h3>캡슐 추첨기</h3>
                </div>
                <label className="gacha-motion-toggle">
                  <input type="checkbox" checked={motionEnabled} disabled={pending} onChange={event => setMotionEnabled(event.target.checked)}/>
                  <span>애니메이션 {motionEnabled ? 'ON' : 'OFF'}</span>
                </label>
              </div>

              <GachaMachine phase={phase}/>

              <div className="gacha-control-panel">
                {selectedGacha ? (
                    <>
                      <div className="gacha-selected-info">
                        <span className={`gacha-status-tag is-${gachaStatus(selectedGacha).type}`}>{gachaStatus(selectedGacha).text}</span>
                        <h4>{selectedGacha.name}</h4>
                        <p>{periodText(selectedGacha)}</p>
                      </div>
                      <div className="gacha-price-info">
                        <div><span>추첨 비용</span><strong>{coinText(selectedGacha.price)} 코인</strong></div>
                        <div><span>보유 코인</span><strong>{coinText(character?.currency)} 코인</strong></div>
                      </div>
                      <button type="button" className="gacha-draw-button" disabled={!!reason} onClick={() => draw(selectedGacha)}>
                        {pending ? '추첨 진행 중...' : '캡슐 1회 뽑기'}
                      </button>
                      {reason && <p className="gacha-draw-reason">{reason}</p>}
                    </>
                ) : (
                    <p className="gacha-control-empty">왼쪽에서 가챠를 선택하면 추첨할 수 있습니다.</p>
                )}

                {failure && <p className="gacha-failure" role="alert">{failure}</p>}
                {result && <GachaResult result={result} imageUrl={result.rewardImageUrl}/>}
              </div>
            </div>

            <div className="gacha-reward-section">
              <div className="gacha-section-heading">
                <div>
                  <h3>보상 목록</h3>
                  <p>선택한 가챠에서 나올 수 있는 아이템입니다.</p>
                </div>
                <span>{rewardList?.length ?? 0}종</span>
              </div>

              {!selectedGacha ? (
                  <div className="gacha-reward-empty">가챠를 선택하면 보상 목록을 확인할 수 있습니다.</div>
              ) : !rewardList ? (
                  <div className="gacha-reward-empty">보상 목록 API가 아직 반영되지 않았습니다. 서버 반영 후 새로고침해 주세요.</div>
              ) : rewardList.length === 0 ? (
                  <div className="gacha-reward-empty">현재 등록된 보상이 없습니다.</div>
              ) : (
                  <div className="gacha-reward-grid">
                    {rewardList.map(reward => {
                      const status = rewardStatus(reward);

                      return (
                          <div className="gacha-reward-card" key={reward.id}>
                            <RewardImage key={`${reward.id}:${reward.image_url || ''}`} url={reward.image_url} name={reward.name}/>
                            <strong title={reward.name}>{reward.name}</strong>
                            <span className={`gacha-reward-stock is-${status.type}`}>{status.text}</span>
                            {reward.description && <small title={reward.description}>{reward.description}</small>}
                          </div>
                      );
                    })}
                  </div>
              )}
              <p className="gacha-reward-guide">품절된 보상은 추첨에서 제외되며, 실제 재고는 추첨 시 서버에서 다시 확인합니다.</p>
            </div>

            {recentRewards.length > 0 && (
                <div className="gacha-reward-section gacha-recent-section">
                  <div className="gacha-section-heading">
                    <div>
                      <h3>최근 획득한 보상</h3>
                      <p>이번 접속에서 뽑은 아이템입니다.</p>
                    </div>
                    <span>{recentRewards.length}건</span>
                  </div>
                  <div className="gacha-reward-grid">
                    {recentRewards.map(reward => (
                        <div className="gacha-reward-card" key={reward.drawKey}>
                          <RewardImage key={`${reward.drawKey}:${reward.image_url || ''}`} url={reward.image_url} name={reward.name}/>
                          <strong title={reward.name}>{reward.name}</strong>
                          <span className="gacha-reward-quantity">× {reward.quantity ?? 1}</span>
                          <small title={reward.gachaName}>{reward.gachaName}</small>
                        </div>
                    ))}
                  </div>
                </div>
            )}
          </div>
        </div>

        <p className="gacha-footer-note">가챠는 1회당 코인 1개를 소비합니다. 설정된 보상 가중치에 따라 무작위 추첨되며 품절된 보상은 제외됩니다.</p>
      </section>
  );
}