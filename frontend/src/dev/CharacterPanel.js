import {useEffect, useState} from 'react';
import {api} from '../api/client';

export default function CharacterPanel({character, error, busy, run, onCharacter, refresh, notify}) {
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
          ['혈액', `${character.blood}/${character.max_blood}`], ['재화', character.currency]
        ].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}
      </div>
      <p>ID {character.id} · 등급 {character.hunter_grade} · 상태 {character.status}</p>
      <div className="actions">
        <button disabled={busy || !!error || character.ap <= 0} onClick={() => run(() => changeAp(-1))}>AP -1 테스트</button>
        <button disabled={busy || !!error || character.ap >= character.max_ap} onClick={() => run(() => changeAp(1))}>AP +1 테스트</button>
      </div>
      <form onSubmit={event => {
        event.preventDefault();
        run(async () => {
          const data = await api('/characters/me/profile', {method: 'PATCH', body: {name}});
          onCharacter(data.character);
          notify('이름을 저장했습니다.');
        });
      }}>
        <label htmlFor="name">캐릭터 이름</label>
        <input id="name" value={name} onChange={event => setName(event.target.value)} maxLength={40} required disabled={busy}/>
        <button disabled={busy || !!error}>이름 저장</button>
      </form>
    </>}
  </section>;
}
