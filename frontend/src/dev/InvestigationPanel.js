import {useState} from 'react';
import {api} from '../api/client';

export default function InvestigationPanel({areas, character, error, characterError, busy, run, refresh, notify}) {
  const [latest, setLatest] = useState(null);
  const blocked = !character || character.status === 'DEAD' || Number(character.ap) < 1 || !!error || !!characterError;

  async function investigate(area) {
    setLatest(null);
    const requestKey = crypto.randomUUID();
    const data = await api(`/investigation/${area.id}`, {method: 'POST', body: {requestKey}});
    setLatest({data, requestKey, areaName: area.name});
    const synced = await refresh();
    notify(synced ? '조사 완료 · 캐릭터·지역·인벤토리 상태 동기화 완료' : '조사는 완료됐지만 일부 상태 조회에 실패했습니다. 패널 오류 확인 후 새로고침하세요.');
  }

  return <section aria-labelledby="investigation-title">
    <span className="badge">INVESTIGATION</span>
    <h2 id="investigation-title">조사 DEV</h2>
    <p>조사 1회당 AP 1을 소비합니다. 최초 발견은 모든 캐릭터가 공유합니다.</p>
    <button disabled={busy} onClick={() => run(refresh)}>조사 지역 새로고침</button>
    {error && <p role="alert">지역 조회 실패: {error} · 이전 표시값일 수 있습니다.</p>}
    {character?.status === 'DEAD' && <p>DEAD 캐릭터는 조사할 수 없습니다.</p>}
    {character && Number(character.ap) < 1 && <p>AP가 부족합니다. 캐릭터 DEV에서 AP +1 테스트 후 다시 시도하세요.</p>}
    {!error && areas.length === 0 && <p>접근 가능한 조사 지역이 없습니다.</p>}
    <ul className="dev-list">
      {areas.map(area => <li className="dev-row" key={area.id}>
        <h3>{area.name}</h3>
        <p>{area.description || '설명 없음'}</p>
        <p>진행률 <strong>{area.investigation_rate}%</strong> · ID {area.id} · {area.is_open ? '오픈' : '닫힘'}</p>
        <p>unlock_at: {area.unlock_at || '제한 없음'}</p>
        <button disabled={busy || blocked || !area.is_open} onClick={() => run(() => investigate(area))}>조사하기</button>
      </li>)}
    </ul>
    {latest && <div className="dev-result" aria-label="최근 조사 결과" aria-live="polite">
      <h3>최근 조사 결과 · {latest.areaName}</h3>
      <p>{latest.data.result.result_text}</p>
      <p>등급 {latest.data.result.result_grade} · unique {latest.data.result.is_unique ? '예' : '아니오'} · 최초 발견 {latest.data.firstDiscovery ? '예' : '아니오'}</p>
      <p>조사 진행률 {latest.data.area.investigation_rate}% · 변경 후 AP {latest.data.ap}</p>
      <h4>지급된 보상</h4>
      {latest.data.rewards.length === 0 ? <p>지급된 보상 없음</p> : <ul>
        {latest.data.rewards.map(reward => <li key={reward.rewardId}>{reward.name} × {reward.quantity} · 지급 후 보유 {reward.inventoryQuantity}</li>)}
      </ul>}
      <h4>단서 정보</h4>
      {latest.data.clue ? <>
        <strong>{latest.data.clue.title}</strong>
        <p className="dev-text">{latest.data.clue.content}</p>
        {latest.data.clue.related_target && <p>관련 대상: {latest.data.clue.related_target}</p>}
      </> : <p>연결된 단서 없음</p>}
      <details><summary>응답 JSON / requestKey</summary><pre>{JSON.stringify(latest, null, 2)}</pre></details>
    </div>}
  </section>;
}
