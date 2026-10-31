import {useRef, useState} from 'react';
import {api} from '../api/client';

export default function ShopPanel({products, character, error, busy, run, refresh, notify}) {
  const [quantities, setQuantities] = useState({});
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState('');
  const sending = useRef(false);
  const blocked = busy || !character || !!error || character.status === 'DEAD';
  const nearBlocked = product => character?.status==='NEAR_DEATH' && product.effect_type!=='BLOOD_PACK';
  const count = id => quantities[id] ?? '1';
  const valid = value => /^[1-9][0-9]*$/.test(value) && Number(value) <= 2147483647;
  async function buy(product) {
    if (sending.current || blocked || nearBlocked(product) || !valid(count(product.id))) return;
    sending.current = true;
    try {
      await run(async () => {
        setResult(null); setFailure('');
        try {
          const data = await api(`/shop/products/${product.id}/buy`, {
            method: 'POST', body: {quantity: Number(count(product.id)), requestKey: crypto.randomUUID()}
          });
          setResult(data);
        } catch (e) { setFailure(`${e.code || 'NETWORK_ERROR'}: ${e.message}`); return; }
        let synced = false;
        try { synced = await refresh(); } catch { /* Purchase already committed. */ }
        notify(synced ? '구매 성공 · 전체 상태 갱신 완료' : '구매 성공 · 일부 조회 실패, 새로고침 필요');
      });
    } finally { sending.current = false; }
  }
  return <section aria-labelledby="shop-title">
    <span className="badge">SHOP</span><h2 id="shop-title">상점 DEV</h2>
    <p>개인 한도는 캐릭터별 전체 운영 기간 누적 수량입니다. 전체 재고는 모든 캐릭터가 공유합니다.</p>
    {character?.status === 'NEAR_DEATH' && <p>빈사 상태에서는 혈액팩만 구매할 수 있습니다.</p>}
    {character?.status === 'DEAD' && <p>DEAD 캐릭터는 구매할 수 없습니다.</p>}
    <button disabled={busy} onClick={() => run(refresh)}>상품 새로고침</button>
    {error && <p role="alert">상품 조회 실패: {error} · 이전 표시값일 수 있습니다.</p>}
    {!error && !products.length && <p>등록된 판매 상품이 없습니다.</p>}
    <ul className="dev-list">{products.map(product => <li className="dev-row" key={product.id}>
      <h3>{product.name} · 상품 {product.id}</h3><p>{product.description}</p>
      <p>개당 가격 {product.price} · 개인 잔여 {product.personalRemaining ?? '무제한'} · 전체 잔여 {product.globalRemaining ?? '무제한'} · 오늘 잔여 {product.dailyRemaining ?? '무제한'}</p>
      <label htmlFor={`shop-${product.id}`}>구매 수량</label>
      <input id={`shop-${product.id}`} inputMode="numeric" value={count(product.id)} disabled={busy}
        onChange={event => setQuantities({...quantities, [product.id]: event.target.value})}/>
      <button disabled={blocked || nearBlocked(product) || (product.dailyRemaining != null && Number(count(product.id)) > product.dailyRemaining) || !valid(count(product.id)) ||
        (product.personalRemaining !== null && Number(count(product.id)) > product.personalRemaining) ||
        (product.globalRemaining !== null && Number(count(product.id)) > product.globalRemaining)} onClick={() => buy(product)}>구매</button>
    </li>)}</ul>
    {failure && <p role="alert">{failure}</p>}
    {result && <div className="dev-result"><h3>구매 성공</h3><pre>{JSON.stringify(result, null, 2)}</pre></div>}
  </section>;
}
