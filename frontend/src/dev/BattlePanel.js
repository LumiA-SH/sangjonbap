import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import {publicAsset} from '../publicAsset';
import './BattlePanel.css';

const FALLBACK_AVATAR = publicAsset('assets/decor/icon-user.svg');

const labels = {
  ATTACK: '일반공격',
  DEFEND: '방어',
  ABILITY: '이능공격',
  ITEM: '아이템 사용',
  FLEE: '도주',
  BLOCK_FLEE: '도주차단'
};

const effectLabels = {
  BLOOD_PACK: '혈량 회복',
  FIXED_DAMAGE: '고정 피해',
  STUN: '기절',
  POISON: '중독',
  SMOKE: '연막'
};

const battleStatusLabels = {
  ACTIVE: '전투 진행 중',
  VICTORY: '승리',
  DEFEAT: '패배',
  FLED: '도주'
};

const characterStatusLabels = {
  ALIVE: '생존',
  NEAR_DEATH: '빈사',
  DEAD: '사망'
};

function effectDescription(item) {
  const value = Number(item.effect_value);

  switch (item.effect_type) {
    case 'BLOOD_PACK': return `혈량 +${value}`;
    case 'FIXED_DAMAGE': return `마물 HP -${value} (DEF 무시)`;
    case 'STUN': return `다음 마물 행동 ${value}회 취소`;
    case 'POISON': return '다음 턴부터 3턴간 10 피해';
    case 'SMOKE': return `다음 도주 확률 +${value}%p`;
    default: return '';
  }
}

function ResourceGauge({label, value, maximum, dark = false}) {
  const current = Number(value);
  const max = Number(maximum);
  const percent = Number.isFinite(current) && Number.isFinite(max) && max > 0
      ? Math.max(0, Math.min(100, current / max * 100)) : 0;

  return (
      <div className={`battle-resource${dark ? ' is-dark' : ''}`}>
        <div className="battle-resource-heading">
          <span>{label}</span>
          <strong>{value ?? '—'} <small>/ {maximum ?? '—'}</small></strong>
        </div>
        <div className="battle-resource-track" role="progressbar" aria-label={`${label} 비율`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
          <span style={{width: `${percent}%`}}/>
        </div>
      </div>
  );
}

function CharacterPortrait({character}) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = character?.image_url || character?.profile_image_url || '';
  const validImage = typeof imageUrl === 'string' && /^(https?:\/\/|\/(?!\/))/.test(imageUrl);
  const isFallback = !validImage || imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
      <div className={`battle-character-portrait${isFallback ? ' is-fallback' : ''}`}>
        <img src={isFallback ? FALLBACK_AVATAR : imageUrl} alt={`${character?.name || '내 캐릭터'} 프로필 이미지`} onError={() => setImageFailed(true)}/>
      </div>
  );
}

function actorLabel(value) {
  return {CHARACTER: '캐릭터', PLAYER: '캐릭터', MONSTER: '마물', SYSTEM: '시스템'}[value] || value;
}

export default function BattlePanel({inventory = [], busy, run, refresh, revision = 0}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [itemId, setItemId] = useState('');
  const sending = useRef(false);
  const request = useRef(null);

  async function load() {
    const token = {};
    request.current = token;
    setLoading(true);
    setError('');

    try {
      const current = await api('/battles/latest');
      if (request.current === token) setData(current);
    } catch (e) {
      if (request.current === token) {
        setData(null);
        setError(`${e.code || 'BATTLE_FAILED'}: ${e.message}`);
      }
    } finally {
      if (request.current === token) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => {request.current = null;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  useEffect(() => {
    setImageFailed(false);
  }, [data?.battle?.monster?.image_url]);

  const battle = data?.battle;
  const character = data?.character;
  const active = battle?.battle_status === 'ACTIVE';

  const items = inventory.filter(item =>
      item.battle_usable && item.usable &&
      ['BLOOD_PACK', 'FIXED_DAMAGE', 'STUN', 'POISON', 'SMOKE'].includes(item.effect_type) &&
      Number(item.quantity) > 0
  );

  const selectedItem = items.find(item => String(item.item_id) === itemId);

  function reason(action) {
    if (!active) return '종료된 전투입니다.';

    if (character.status === 'DEAD' || Number(character.hp) <= 0) {
      return '사망 상태에서는 행동할 수 없습니다.';
    }

    if (character.status === 'NEAR_DEATH' || Number(character.blood) <= 0) {
      return '혈량 0의 빈사 상태입니다. 전투 상태를 새로고침하세요.';
    }

    if (action === 'ABILITY') {
      if (!character.has_ability || !character.ability_grade) {
        return '이능을 보유하지 않았습니다.';
      }

      const cost = battle.abilityApCosts?.[character.ability_grade];

      if (!Number.isInteger(cost)) {
        return '필요 AP 정보를 확인할 수 없습니다. 새로고침하세요.';
      }

      if (Number(character.ap) < cost) {
        return `AP 부족: 필요 ${cost}, 현재 ${character.ap}`;
      }
    }

    if (action === 'ITEM' && !selectedItem) {
      return '사용할 전투 아이템을 선택하세요.';
    }

    return '';
  }

  const imageUrl = battle?.monster?.image_url;
  const safeImage = typeof imageUrl === 'string' && /^(https?:\/\/|\/(?!\/))/.test(imageUrl);

  async function command(action) {
    if (sending.current || busy || loading || !active || !battle.options.includes(action) || reason(action)) return;

    sending.current = true;

    try {
      await run(async () => {
        setError('');

        try {
          const result = await api(`/battles/${battle.id}/commands`, {
            method: 'POST',
            body: {
              requestKey: crypto.randomUUID(),
              turnNo: battle.turn_no,
              action,
              ...(action === 'ITEM' ? {itemId} : {})
            }
          });

          setData({...result, logs: []});
          await refresh();
          await load();
        } catch (e) {
          await load();
          setError(`${e.code || 'BATTLE_FAILED'}: ${e.message}`);
        }
      });
    } finally {
      sending.current = false;
    }
  }

  const effects = battle?.statusEffects || {};
  const stun = Number(effects.stunRemaining) || 0;
  const poison = Number(effects.poisonRemaining) || 0;
  const smoke = Number(effects.smokeBonus) || 0;
  const hasEffects = stun > 0 || poison > 0 || smoke > 0;
  const logs = data?.logs || [];

  return (
      <section id="battle-panel" className="survival-battle" aria-label="일반 PVE 전투">
        <header className="battle-header">
          <div>
            <h2>일반 PVE 전투</h2>
            <p>전투 상황을 확인하고 다음 행동을 선택하세요. 진행 중인 일반 전투는 매일 00:00 KST에 중단됩니다.</p>
          </div>
          <div className="battle-header-controls">
            {battle && <span className={`battle-status-badge${active ? ' is-active' : ''}`}>{battle.end_reason==='MIDNIGHT_INTERRUPTED'?'자정 중단':battle.battle_status==='FLED'?(battle.fled_actor_type==='MONSTER'?'마물 도주':'캐릭터 도주'):(battleStatusLabels[battle.battle_status] || battle.battle_status)}</span>}
            <button type="button" disabled={busy || loading} onClick={load}>전투 새로고침</button>
          </div>
        </header>

        {loading && <p className="battle-message" role="status">전투 상태 확인 중…</p>}
        {error && <p className="battle-error" role="alert">{error}</p>}

        {!loading && !battle && !error && (
            <div className="battle-empty">
              <h3>진행 중인 전투가 없습니다.</h3>
              <p>조사 중 마물과 조우하면 이곳에서 전투를 진행할 수 있습니다.</p>
            </div>
        )}

        {battle && (
            <>
              <div className="battle-enemy">
                <div className="battle-monster-image">
                  {safeImage && !imageFailed
                      ? <img src={imageUrl} alt={battle.monster?.name || '마물'} onError={() => setImageFailed(true)}/>
                      : <p role="img" aria-label="마물 이미지 없음">마물 이미지 없음</p>}
                </div>

                <div className="battle-enemy-info">
                  <div className="battle-enemy-heading">
                    <div>
                      <span className="battle-section-label">마물</span>
                      <h3>{battle.monster?.name || `마물 ${battle.monster_id}`}</h3>
                    </div>
                    <div className="battle-turn">
                      <small>현재 턴</small>
                      <strong>{battle.turn_no}</strong>
                    </div>
                  </div>

                  <ResourceGauge label="마물 HP" value={battle.monster_hp} maximum={battle.monster_max_hp} dark/>

                  {active ? (
                      <div className="battle-forecast">
                        <span>다음 행동 예고</span>
                        <strong>{battle.declaration?.name || '행동 정보 없음'}</strong>
                        {battle.declaration?.description && <p>{battle.declaration.description}</p>}
                        {battle.declaration?.action_type && <small>{battle.declaration.action_type}</small>}
                      </div>
                  ) : (
                      <p className="battle-end-reason">전투 종료 · 종료 사유: {({MIDNIGHT_INTERRUPTED:'자정 시스템 중단',MONSTER_KILLED:'마물 처치',PC_DEAD:'캐릭터 사망',PC_NEAR_DEATH:'캐릭터 빈사',ESCAPED:'도주 성공',TIMEOUT:'과거 만료 기록'})[battle.end_reason] || battle.end_reason || '-'}</p>
                  )}
                </div>
              </div>

              <section className="battle-character">
                <div className="battle-panel-heading">
                  <h3>캐릭터 상태</h3>
                  <span>{characterStatusLabels[character.status] || character.status || '-'}</span>
                </div>

                <div className="battle-character-profile">
                  <CharacterPortrait character={character}/>

                  <div className="battle-character-identity">
                    <span>내 캐릭터</span>
                    <h4>{character.name || `캐릭터 ${character.id}`}</h4>

                    <div className="battle-character-stats">
                      {[
                        ['ATK', character.atk],
                        ['DEF', character.def],
                        ['AGI', character.agi]
                      ].map(([label, value]) => (
                          <div key={label}>
                            <span>{label}</span>
                            <strong>{value ?? '—'}</strong>
                          </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="battle-character-resources">
                  <ResourceGauge label="HP" value={character.hp} maximum={character.max_hp}/>
                  <ResourceGauge label="혈량" value={character.blood} maximum={Math.min(100, character.max_blood)}/>
                  <ResourceGauge label="AP" value={character.ap} maximum={character.max_ap}/>
                </div>

                {active && hasEffects && (
                    <div className="battle-effects" aria-label="전투 지속 효과">
                      <h4>적용 중인 효과</h4>
                      <div className="battle-effect-list">
                        {stun > 0 && <span>마물 기절 · 행동 취소 {stun}회 남음</span>}
                        {poison > 0 && <span>마물 중독 · 피해 적용 {poison}턴 남음</span>}
                        {smoke > 0 && <span>연막 · 다음 도주 성공률 +{smoke}%p</span>}
                      </div>
                    </div>
                )}
              </section>

              {active && (
                  <section className="battle-command-panel">
                    <div className="battle-panel-heading">
                      <h3>행동 선택</h3>
                      <span>가능한 행동 중 하나를 선택하세요.</span>
                    </div>

                    <div className="battle-item-control">
                      <label htmlFor="battle-consumable">전투 소비 아이템</label>
                      <select id="battle-consumable" value={itemId} disabled={busy || loading} onChange={e => setItemId(e.target.value)}>
                        <option value="">아이템 선택</option>
                        {items.map(item => (
                            <option key={item.item_id} value={item.item_id}>{item.name} × {item.quantity} · {effectLabels[item.effect_type]}</option>
                        ))}
                      </select>
                      {selectedItem && <p>{selectedItem.name}: {effectDescription(selectedItem)} · 행동 1회·아이템 1개 소모·AP 소모 없음</p>}
                    </div>

                    <div className="battle-command-actions">
                      {battle.options.map(action => (
                          <button key={action} type="button" className={action === 'ATTACK' ? 'is-primary' : ''} disabled={busy || loading || !!reason(action)} title={reason(action)} onClick={() => command(action)}>
                            {labels[action] || action}
                          </button>
                      ))}
                    </div>

                    {battle.options.some(action => reason(action)) && (
                        <ul className="battle-disabled-reasons" aria-label="행동 불가 사유">
                          {battle.options.filter(action => reason(action)).map(action => (
                              <li key={action}>{labels[action] || action}: {reason(action)}</li>
                          ))}
                        </ul>
                    )}

                    <p className="battle-timing">
                      마지막 정상 행동: {battle.last_command_at || battle.started_at} · 진행 중인 일반 PVE 전투는 매일 00:00(한국 시간)에 중단됩니다.
                    </p>
                  </section>
              )}

              {!active && (
                  <section className="battle-result" aria-label="전투 결과">
                    <div className="battle-result-heading">
                      <span>전투 종료</span>
                      <h3>{battle.end_reason==='MIDNIGHT_INTERRUPTED'?'자정 중단':battle.battle_status==='FLED'?(battle.fled_actor_type==='MONSTER'?'마물 도주':'캐릭터 도주'):(battleStatusLabels[battle.battle_status] || battle.battle_status)}</h3>
                    </div>

                    {battle.battle_status === 'VICTORY' && Number(battle.character_hp ?? character.hp) === 0 && (
                        <p className="battle-result-warning" role="status">동귀어진: 전투는 승리했지만 PC는 사망했습니다. 처치 보상은 정상 지급됩니다.</p>
                    )}

                    <div className="battle-result-summary">
                      <div><small>캐릭터 상태</small><strong>{characterStatusLabels[character.status] || character.status || '-'}</strong></div>
                      <div><small>마물 처치</small><strong>{battle.battle_status === 'VICTORY' ? '예' : '아니오'}</strong></div>
                      <div><small>지급 재화</small><strong>{data.currencyReward || 0}</strong></div>
                    </div>

                    <div className="battle-result-rewards">
                      <h4>획득 보상</h4>
                      {(data.rewards || []).length > 0 ? (
                          <ul>
                            {data.rewards.map((reward, index) => (
                                <li key={index}>
                                  {reward.name || `아이템 ${reward.itemId}`} {reward.recipeId ? '· 레시피 무료 습득' : `× ${reward.quantity}`}
                                  {reward.guaranteed ? ' · 식재료 보장' : ''}
                                </li>
                            ))}
                          </ul>
                      ) : <p>획득한 보상이 없습니다.</p>}
                    </div>
                  </section>
              )}

              <section className="battle-log-panel">
                <div className="battle-panel-heading">
                  <h3>전투 기록</h3>
                  <span>최근 100건</span>
                </div>

                {logs.length > 0 ? (
                    <ol className="battle-log-list">
                      {logs.map(log => (
                          <li key={log.id}>
                            <span className="battle-log-turn">{log.turn_no}턴</span>
                            <div className="battle-log-content">
                              <span>{actorLabel(log.actor_type)} · {labels[log.action_type] || log.action_type}</span>
                              <p>{log.message}</p>
                            </div>
                            <span className="battle-log-damage">피해 {log.damage ?? '-'}</span>
                          </li>
                      ))}
                    </ol>
                ) : <p className="battle-log-empty">표시할 전투 기록이 없습니다.</p>}
              </section>
            </>
        )}
      </section>
  );
}