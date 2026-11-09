import AnemiaNotice from '../public/AnemiaNotice';
import {useEffect, useState} from 'react';
import {api} from '../api/client';

export default function CharacterPanel({character, error, busy, run, onCharacter, refresh, notify,dev=true}) {
  const [name, setName] = useState('');
  useEffect(() => { setName(character?.name || ''); }, [character?.name]);

  async function changeAp(delta) {
    const data = await api('/characters/me/resources', {
      method: 'PATCH', body: {ap: delta, reason: 'DEV_RESOURCE_TEST'}
    });
    onCharacter(data.character);
    await refresh();
    notify(`AP ${delta > 0 ? '+' : ''}${delta} 처리 완료`);
  }

  const blocked = busy || character?.in_active_battle || character?.status==='DEAD';
  return <section aria-labelledby="character-title">
    <span className="badge">CHARACTER</span>
    <h2 id="character-title">캐릭터 DEV</h2>
    {error && <p role="alert">조회 실패: {error} · 이전 표시값일 수 있습니다.</p>}
    <button disabled={busy} onClick={() => run(refresh)}>캐릭터 새로고침</button>
    {!character ? <p>캐릭터 정보를 불러오지 못했습니다.</p> : <>
      <h3>{character.name}</h3>
      <div className="stats">
        {[
          ['HP', `${character.hp}/${character.max_hp}`], ['AP', `${character.ap}/${character.max_ap}`],
          ['혈액', `${character.blood}/${character.effective_max_blood ?? Math.min(100,character.max_blood)}`], ['재화', character.currency]
        ].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}
      </div>
      <AnemiaNotice character={character}/>
      <p>ID {character.id} · 등급 {character.hunter_grade} · 상태 {character.status}</p>
      {character.in_active_battle && <p>진행 중 전투: 전투 행동과 조회만 가능합니다.</p>}
      <p>이능관리등급: {character.ability_grade ?? '없음'}</p>
      <dl>
        {[['나이', character.age], ['직업', character.job], ['포지션', character.position],
          ['외부 프로필 URL', character.profile_url]].map(([label, value]) => <div key={label}>
          <dt>{label}</dt><dd>{value ?? '미등록'}</dd>
        </div>)}
      </dl>
      <p>신규 프로필 입력·수정은 고객 정책 확정 대기 중입니다.</p>
      {dev&&<div className="actions">
        <button disabled={blocked || !!error || character.ap <= 0} onClick={() => run(() => changeAp(-1))}>AP -1 테스트</button>
        <button disabled={blocked || !!error || character.ap >= character.max_ap} onClick={() => run(() => changeAp(1))}>AP +1 테스트</button>
      </div>}
      <form onSubmit={event => {
        event.preventDefault();
        run(async () => {
          const data = await api('/characters/me/profile', {method: 'PATCH', body: {name}});
          onCharacter(data.character);
          notify('이름을 저장했습니다.');
        });
      }}>
        <label htmlFor="name">캐릭터 이름</label>
        <input id="name" value={name} onChange={event => setName(event.target.value)} maxLength={40} required disabled={blocked}/>
        <button disabled={blocked || !!error}>이름 저장</button>
      </form>
    </>}
  </section>;
}
