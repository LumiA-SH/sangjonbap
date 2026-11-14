import {useRef,useState} from 'react';
import {api} from '../api/client';

export function rewardText(reward) {
  return reward.recipeId != null
      ? `${reward.name} · 레시피 최초 발견 · 무료 습득 · 상점 등록`
      : `${reward.name} × ${reward.quantity} · 지급 후 보유 ${reward.inventoryQuantity}`;
}

export default function InvestigationPanel({activeBattle, battleError, areas, globalInvestigationRate, investigationApCost, character, error, characterError, busy, run, refresh, notify}) {
  const [latest, setLatest] = useState(null);
  const pending=useRef(null),sending=useRef(false);
  const [uncertain,setUncertain]=useState(null);
  const costReady = Number.isSafeInteger(investigationApCost) && investigationApCost >= 0;
  const insufficientAp = costReady && character && Number(character.ap) < investigationApCost;
  const blocked = !costReady || !character || ['DEAD','NEAR_DEATH'].includes(character.status) || activeBattle || !!battleError || insufficientAp || !!error || !!characterError;

  async function investigate(area) {
    if(sending.current)return;
    if(pending.current&&pending.current.characterId!==character?.id){notify('이전 캐릭터의 미확인 조사 기록을 먼저 확인하세요.');return;}
    if(pending.current&&pending.current.area.id!==area.id){notify('이전 지역의 미확인 조사를 먼저 확인하세요.');return;}

    sending.current=true;
    const attempt=pending.current||{requestKey:crypto.randomUUID(),area,characterId:character?.id};
    const retry=!!pending.current;
    pending.current=attempt;
    setLatest(null);
    const {requestKey}=attempt;
    let checking=retry;

    try {
      if(retry){
        const {records}=await api(`/records/action-logs?requestKey=${requestKey}`);
        const log=records.find(r=>r.request_key===requestKey&&r.action_type==='INVESTIGATE');

        if(log){
          pending.current=null;
          setUncertain(null);
          await refresh();
          notify(`조사 완료 기록 확인 · 재실행하지 않았습니다. requestKey: ${requestKey}`);
          return;
        }
      }

      checking=false;
      const data = await api(`/investigation/${area.id}`, {method: 'POST', body: {requestKey}});
      pending.current=null;
      setUncertain(null);
      setLatest({data, requestKey, areaName: area.name});

      const synced = await refresh();
      notify(synced ? '조사 완료 · 캐릭터·지역·인벤토리 상태 동기화 완료' : '조사는 완료됐지만 일부 상태 조회에 실패했습니다. 패널 오류 확인 후 새로고침하세요.');
    } catch(error){
      if(error.code==='DUPLICATE_REQUEST'){
        pending.current=null;
        setUncertain(null);
        await refresh();
        notify(`이미 처리된 조사입니다. 기록을 확인하세요. requestKey: ${requestKey}`);
        return;
      }

      if(pending.current){
        if(!retry&&!checking&&error.status>=400&&error.status<500&&error.code!=='API_RESPONSE_INVALID'){
          pending.current=null;
          setUncertain(null);
        } else {
          setUncertain(attempt);
        }
      }

      throw error;
    } finally {
      sending.current=false;
    }
  }

  return <section aria-labelledby="investigation-title">
    <span className="badge">INVESTIGATION</span>
    <h2 id="investigation-title">조사 DEV</h2>

    {uncertain&&<p role="status">결과 미확인 · {uncertain.area.name} · requestKey: {uncertain.requestKey} <button disabled={busy} onClick={()=>run(()=>investigate(uncertain.area))}>기록 확인 및 같은 요청 재시도</button></p>}

    <p>{costReady ? `조사 1회당 AP ${investigationApCost}을 소비합니다.` : '조사 비용을 불러오지 못했습니다.'} 최초 발견은 모든 캐릭터가 공유합니다. 조사 완료 후 지역 설정에 따라 조우를 별도로 판정합니다. 개별 보상 확률에 따라 지급물이 없을 수 있습니다.</p>

    <p>전체 조사율: <strong>{Number.isFinite(globalInvestigationRate) ? `${globalInvestigationRate}%` : '조회 필요'}</strong></p>

    {activeBattle && <p>진행 중인 전투를 종료한 후 조사할 수 있습니다.</p>}
    {battleError && <p role="alert">전투 상태 확인 실패: {battleError}</p>}
    {character?.status === 'NEAR_DEATH' && <p>빈사 상태에서는 지역 조회만 가능합니다.</p>}

    <button disabled={busy} onClick={() => run(refresh)}>조사 지역 새로고침</button>

    {error && <p role="alert">지역 조회 실패: {error} · 이전 표시값일 수 있습니다.</p>}
    {character?.status === 'DEAD' && <p>DEAD 캐릭터는 조사할 수 없습니다.</p>}
    {insufficientAp && <p>AP가 부족합니다. 캐릭터 DEV에서 AP +1 테스트 후 다시 시도하세요.</p>}
    {!error && areas.length === 0 && <p>접근 가능한 조사 지역이 없습니다.</p>}

    <ul className="dev-list">
      {areas.map(area => <li className="dev-row" key={area.id}>
        <h3>{area.name}</h3>
        <p>{area.description || '설명 없음'}</p>
        <p>진행률 <strong>{area.investigation_rate}%</strong> · ID {area.id} · {area.is_open ? '오픈' : '닫힘'}</p>
        <p>조우 확률: {area.encounter_rate ?? '조회 필요'}% · unlock_at: {area.unlock_at || '제한 없음'}</p>
        <button disabled={busy || blocked || !area.is_open} onClick={() => run(() => investigate(area))}>조사하기</button>
      </li>)}
    </ul>

    {latest && <div className="dev-result" aria-label="최근 조사 결과" aria-live="polite">
      <h3>최근 조사 결과 · {latest.areaName}</h3>
      <p>{latest.data.result.result_text}</p>
      <p>고유 결과 {latest.data.result.is_unique ? '예' : '아니오'} · 최초 발견 {latest.data.firstDiscovery ? '예' : '아니오'}</p>
      <p>조사 진행률 {latest.data.area.investigation_rate}% · 변경 후 AP {latest.data.ap}</p>
      <p>{latest.data.battle ? `마물 조우 · 전투 ID ${latest.data.battle.id}` : '조우 없음'} · 조사 보상은 이후 전투 결과와 무관하게 유지됩니다.</p>

      {latest.data.battle&&<a href="#game/battle">전투 화면으로 이동</a>}

      <h4>지급된 보상</h4>
      {latest.data.rewards.length === 0 ? <p>지급된 보상 없음</p> : <ul>
        {latest.data.rewards.map(reward => <li key={reward.rewardId}>{rewardText(reward)}</li>)}
      </ul>}

      <h4>단서 정보</h4>
      {latest.data.clue ? <>
        <strong>{latest.data.clue.title}</strong>
        <p className="dev-text">{latest.data.clue.content}</p>
        {latest.data.clue.related_target && <p>관련 대상: {latest.data.clue.related_target}</p>}
      </> : <p>연결된 단서 없음</p>}

      <details>
        <summary>응답 JSON / requestKey</summary>
        <pre>{JSON.stringify(latest, null, 2)}</pre>
      </details>
    </div>}
  </section>;
}