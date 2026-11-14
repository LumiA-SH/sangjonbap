import {useEffect, useState} from 'react';
import {api} from '../api/client';
import {publicAsset} from '../publicAsset';

const FALLBACK_AVATAR = publicAsset('assets/decor/icon-user.svg');

const statusNames = {
  ALIVE: '생존',
  NEAR_DEATH: '빈사',
  DEAD: '사망'
};

function ResourceMeter({label, value, max}) {
  const current = Number(value);
  const maximum = Number(max);
  const valid = Number.isFinite(current) && Number.isFinite(maximum);
  const safeMax = valid && maximum > 0 ? maximum : 1;
  const safeValue = valid ? Math.max(0, Math.min(current, safeMax)) : 0;

  return (
      <div className="character-resource-meter">
        <div className="character-resource-label">
          <strong>{label}</strong>
          <span>{value ?? '-'} / {max ?? '-'}</span>
        </div>

        <progress max={safeMax} value={safeValue} aria-label={label}/>
      </div>
  );
}

export default function CharacterPanel({
                                         character,
                                         error,
                                         busy,
                                         run,
                                         onCharacter,
                                         refresh,
                                         notify,
                                         dev = true
                                       }) {
  const [name, setName] = useState('');
  const [imageFailed, setImageFailed] = useState(false);

  const imageUrl = character?.image_url || character?.profile_image_url || '';
  const validImage = typeof imageUrl === 'string' &&
      (/^https?:\/\//i.test(imageUrl) || /^\/(?!\/)/.test(imageUrl));

  useEffect(() => {
    setName(character?.name || '');
  }, [character?.name]);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  async function changeAp(delta) {
    const data = await api('/characters/me/resources', {
      method: 'PATCH',
      body: {ap: delta, reason: 'DEV_RESOURCE_TEST'}
    });

    onCharacter(data.character);
    await refresh();
    notify(`AP ${delta > 0 ? '+' : ''}${delta} 처리 완료`);
  }

  async function saveName(event) {
    event.preventDefault();

    await run(async () => {
      const data = await api('/characters/me/profile', {
        method: 'PATCH',
        body: {name}
      });

      onCharacter(data.character);
      notify('이름을 저장했습니다.');
    });
  }

  const blocked = busy ||
      !character ||
      character.initial_setup_complete === false ||
      character.in_active_battle ||
      character.status === 'DEAD';

  const effectiveMaxBlood = character?.effective_max_blood ??
      Math.min(100, character?.max_blood ?? 100);

  const resources = character ? [
    {label: 'HP', value: character.hp, max: character.max_hp},
    {label: '혈량', value: character.blood, max: effectiveMaxBlood},
    {label: 'AP', value: character.ap, max: character.max_ap}
  ] : [];

  const stats = character ? [
    {label: 'ATK', value: character.atk},
    {label: 'DEF', value: character.def},
    {label: 'AGI', value: character.agi}
  ] : [];

  const avatar = validImage && !imageFailed ? imageUrl : FALLBACK_AVATAR;
  const isFallback = avatar === FALLBACK_AVATAR;

  return (
      <section className="survival-character-overview" aria-labelledby="character-title">
        <header className="survival-character-heading">
          <div>
            <span className="badge">SURVIVOR PROFILE</span>
            <h2 id="character-title">내 캐릭터</h2>
          </div>

          <button type="button" disabled={busy} onClick={() => run(refresh)}>
            상태 새로고침
          </button>
        </header>

        {error && (
            <p role="alert">
              조회 실패: {error} · 이전 표시값일 수 있습니다.
            </p>
        )}

        {!character ? (
            <p role="status">캐릭터 정보를 불러오지 못했습니다.</p>
        ) : (
            <>
              <div className="survival-character-profile">
                <div className={`survival-character-portrait${isFallback ? ' is-fallback' : ''}`}>
                  <img
                      src={avatar}
                      alt={`${character.name} 프로필 이미지`}
                      onError={() => setImageFailed(true)}
                  />
                </div>

                <div className="survival-character-identity">
                            <span className="survival-character-caption">
                                SURVIVOR ID #{String(character.id).padStart(3, '0')}
                            </span>

                  <h3>{character.name}</h3>

                  <div className="survival-character-badges">
                                <span className="survival-character-badge">
                                    {character.role || '생존자'}
                                </span>

                    <span className={`survival-character-state state-${String(character.status || '').toLowerCase()}`}>
                                    {statusNames[character.status] || character.status || '미확인'}
                                </span>
                  </div>

                  <div className="survival-character-grades">
                    <span>헌터등급 <strong>{character.hunter_grade ?? '미설정'}</strong></span>
                    <span>이능등급 <strong>
                                    {character.initial_setup_complete === false
                                        ? '미설정'
                                        : character.has_ability === false
                                            ? '없음'
                                            : character.ability_grade ?? '없음'}
                                </strong></span>
                  </div>

                  {character.in_active_battle && (
                      <p className="survival-character-battle-warning">
                        진행 중인 전투가 있습니다. 전투 행동 및 조회만 가능합니다.
                      </p>
                  )}
                </div>

                <div className="survival-character-resources">
                  {resources.map(resource => (
                      <ResourceMeter
                          key={resource.label}
                          label={resource.label}
                          value={resource.value}
                          max={resource.max}
                      />
                  ))}
                </div>
              </div>

              <div className="survival-character-stat-section">
                <div className="survival-character-section-label">
                  <strong>기본 능력치</strong>
                  <span>CHARACTER STATS</span>
                </div>

                <div className="survival-character-stat-grid">
                  {stats.map(stat => (
                      <div className="survival-character-stat" key={stat.label}>
                        <span>{stat.label}</span>
                        <strong>{stat.value ?? '-'}</strong>
                      </div>
                  ))}
                </div>
              </div>

              <div className="survival-character-bottom-info">
                <div className="survival-character-currency">
                  <span>보유 코인</span>
                  <strong>{character.currency ?? '-'}</strong>
                </div>

                <span className="survival-character-setup-state">
                            {character.initial_setup_complete === false
                                ? '운영진의 초기 설정 대기 중'
                                : '캐릭터 설정 완료'}
                        </span>
              </div>

              <details className="survival-character-extra">
                <summary>추가 프로필 정보</summary>

                <dl className="survival-character-extra-grid">
                  {[
                    ['나이', character.age],
                    ['직업', character.job],
                    ['포지션', character.position],
                    ['외부 프로필 URL', character.profile_url]
                  ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value ?? '미등록'}</dd>
                      </div>
                  ))}
                </dl>

                <p>신규 프로필 입력·수정은 고객 정책 확정 대기 중입니다.</p>
              </details>

              <details className="survival-character-extra">
                <summary>캐릭터 이름 변경</summary>

                <form className="survival-character-name-form" onSubmit={saveName}>
                  <label htmlFor="character-name-edit">캐릭터 이름</label>

                  <input
                      id="character-name-edit"
                      value={name}
                      maxLength={40}
                      required
                      disabled={blocked}
                      onChange={event => setName(event.target.value)}
                  />

                  <button disabled={blocked || !!error}>
                    이름 저장
                  </button>
                </form>
              </details>

              {dev && (
                  <details className="survival-character-extra">
                    <summary>개발용 테스트 기능</summary>

                    <div className="actions">
                      <button
                          type="button"
                          disabled={blocked || !!error || Number(character.ap) <= 0}
                          onClick={() => run(() => changeAp(-1))}
                      >
                        AP -1 테스트
                      </button>

                      <button
                          type="button"
                          disabled={blocked || !!error || Number(character.ap) >= Number(character.max_ap)}
                          onClick={() => run(() => changeAp(1))}
                      >
                        AP +1 테스트
                      </button>
                    </div>
                  </details>
              )}
            </>
        )}
      </section>
  );
}