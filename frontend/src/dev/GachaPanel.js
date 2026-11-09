import {useRef, useState} from 'react';
import {api} from '../api/client';

export default function GachaPanel({gachas, character, error, busy, run, refresh, notify}) {
  const [result,setResult] = useState(null);
  const [failure,setFailure] = useState('');
  const sending = useRef(false);
  const blocked = busy || character?.in_active_battle || !!error || !character || character.status==='DEAD' || character.status==='NEAR_DEATH';
  async function draw(gacha) {
    if (sending.current || blocked || gacha.outside || gacha.boundary || gacha.sold_out || gacha.stock_hold || Number(character.currency)<1) return;
    sending.current=true;
    try {
      await run(async()=>{
        setResult(null);setFailure('');
        try {setResult(await api(`/gacha/${gacha.id}/draw`,{method:'POST',body:{requestKey:crypto.randomUUID()}}));}
        catch(e) {setFailure(`${e.code || 'NETWORK_ERROR'}: ${e.message}`);return;}
        let synced=false;
        try {synced=await refresh();} catch { /* Draw already committed. */ }
        notify(synced ? '추첨 완료 · 전체 상태 갱신 완료' : '추첨 완료 · 일부 조회 실패, 새로고침 필요');
      });
    } finally {sending.current=false;}
  }
  return <section aria-labelledby="gacha-title">
    <span className="badge">GACHA</span><h2 id="gacha-title">가챠 DEV</h2>
    <button disabled={busy} onClick={()=>run(refresh)}>가챠 새로고침</button>
    {error && <p role="alert">조회 실패: {error} · 이전 값일 수 있습니다.</p>}
    {character?.status==='DEAD' && <p>DEAD 사용 불가</p>}
    {character?.status==='NEAR_DEATH' && <p>빈사 상태에서는 가챠를 사용할 수 없습니다.</p>}
    {!error && !gachas.length && <p>활성 가챠가 없습니다.</p>}
    <ul className="dev-list">{gachas.map(gacha=><li className="dev-row" key={gacha.id}>
      <h3>{gacha.name}</h3><p>가격 {gacha.price} · ID {gacha.id}</p>
      <p>기간: {gacha.period_enabled===false?'기간 제한 없음':`${gacha.start_at || '시작 제한 없음'} ~ ${gacha.end_at || '종료 제한 없음'}`}</p>
      {gacha.outside && <p>현재 운영 기간 외 · 시작 후 새로고침하세요.</p>}
      {gacha.boundary && <p>HOLD: 기간 경계 포함 정책 확정 대기</p>}
      {gacha.stock_hold?<p>재고 설정 준비 중</p>:gacha.sold_out&&<p>전체 품절</p>}
      {Number(character?.currency)<1&&<p>코인 1개가 필요합니다.</p>}
      <button disabled={blocked || gacha.outside || gacha.boundary || gacha.sold_out || gacha.stock_hold || Number(character?.currency)<1} onClick={()=>draw(gacha)}>1회 뽑기</button>
    </li>)}</ul>
    {failure && <p role="alert">{failure}</p>}
    {result && <div className="dev-result"><h3>추첨 결과</h3><p>{result.reward.name} × {result.reward.quantity}</p>
      <p>{result.reward.description}</p>
      <pre>{JSON.stringify(result,null,2)}</pre></div>}
  </section>;
}
