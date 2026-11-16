import {useRef, useState} from 'react';
import {api} from '../api/client';
import './ShopPanel.css';

const categories = [
  {id: 'ALL', name: '전체 상품'},
  {id: 'BLOOD', name: '혈액팩'},
  {id: 'RECIPE', name: '레시피'},
  {id: 'ITEM', name: '일반 물자'}
];

function productType(product) {
  if (product.recipe_id != null) return 'RECIPE';
  if (product.blood_pack_kind) return 'BLOOD';
  return 'ITEM';
}

function typeLabel(product) {
  return {BLOOD: '혈액팩', RECIPE: '레시피', ITEM: '일반 물자'}[productType(product)];
}

function coinText(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('ko-KR') : '—';
}

function remainingText(value) {
  return value == null ? '무제한' : `${coinText(value)}개`;
}

function stockLabel(product) {
  if (product.learned) return '습득 완료';
  if (product.globalRemaining != null && Number(product.globalRemaining) <= 0) return '품절';
  if (product.dailyRemaining != null && Number(product.dailyRemaining) <= 0) return '오늘 구매 완료';
  if (product.personalRemaining != null && Number(product.personalRemaining) <= 0) return '구매 한도 도달';
  if (product.blood_pack_kind === 'FREE') return '무료';
  return null;
}

function ProductImage({product, small = false}) {
  const [failed, setFailed] = useState(false);
  const url = product?.image_url;
  const valid = typeof url === 'string' && /^(https?:\/\/|\/(?!\/))/.test(url);

  return (
      <div className={`shop-product-image${small ? ' is-small' : ''}`}>
        {valid && !failed
            ? <img src={url} alt={`${product.name} 상품 이미지`} loading="lazy" onError={() => setFailed(true)}/>
            : <span className="shop-product-placeholder" aria-hidden="true"/>}
      </div>
  );
}

export default function ShopPanel({products = [], character, error, busy, run, refresh, notify}) {
  const [category, setCategory] = useState('ALL');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [receipt, setReceipt] = useState(null);
  const [failure, setFailure] = useState('');
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  const blocked = busy || pending || character?.in_active_battle || !character || !!error || character.status === 'DEAD';

  const visibleProducts = products.filter(product => {
    const matchesCategory = category === 'ALL' || productType(product) === category;
    const keyword = query.trim().toLowerCase();
    const matchesQuery = !keyword || `${product.name || ''} ${product.description || ''}`.toLowerCase().includes(keyword);
    return matchesCategory && matchesQuery;
  });

  const selectedProduct = visibleProducts.find(product => String(product.id) === selectedId) || visibleProducts[0] || null;

  function quantityOf(product) {
    if (!product) return '1';
    if (product.recipe_id != null || product.blood_pack_kind === 'FREE') return '1';
    return quantities[product.id] ?? '1';
  }

  function validQuantity(value) {
    return typeof value === 'string' && /^[1-9][0-9]*$/.test(value) &&
        Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647;
  }

  function totalPrice(product) {
    if (!product || !validQuantity(quantityOf(product))) return null;
    const total = Number(product.price) * Number(quantityOf(product));
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
  }

  function purchaseReason(product) {
    if (!product) return '상품을 선택하세요.';
    if (busy || pending) return '처리 중입니다.';
    if (!character) return '캐릭터 정보를 확인할 수 없습니다.';
    if (error) return '상품 정보를 다시 불러와 주세요.';
    if (character.status === 'DEAD') return '사망 상태에서는 구매할 수 없습니다.';
    if (character.in_active_battle) return '전투 중에는 구매할 수 없습니다.';
    if (product.learned) return '이미 습득한 레시피입니다.';

    const quantity = Number(quantityOf(product));

    if (!validQuantity(quantityOf(product))) return '올바른 구매 수량을 입력하세요.';
    if (totalPrice(product) == null) return '구매 금액을 확인할 수 없습니다.';
    if (product.dailyRemaining != null && quantity > Number(product.dailyRemaining)) return '오늘 구매 가능한 수량을 초과했습니다.';
    if (product.personalRemaining != null && quantity > Number(product.personalRemaining)) return '개인 구매 한도를 초과했습니다.';
    if (product.globalRemaining != null && quantity > Number(product.globalRemaining)) return '전체 재고가 부족합니다.';
    if (Number(character.currency) < totalPrice(product)) return '보유 코인이 부족합니다.';

    return '';
  }

  function selectProduct(id) {
    setSelectedId(String(id));
    setFailure('');
    setReceipt(null);
  }

  function changeQuantity(value) {
    if (!selectedProduct) return;
    setQuantities(current => ({...current, [selectedProduct.id]: value}));
    setFailure('');
  }

  function adjustQuantity(delta) {
    if (!selectedProduct) return;
    const current = validQuantity(quantityOf(selectedProduct)) ? Number(quantityOf(selectedProduct)) : 1;
    changeQuantity(String(Math.max(1, Math.min(2147483647, current + delta))));
  }

  async function buy(product) {
    if (sending.current || blocked || purchaseReason(product)) return;

    const quantity = Number(quantityOf(product));
    sending.current = true;
    setPending(true);
    setReceipt(null);
    setFailure('');

    try {
      await run(async () => {
        let data;

        try {
          data = await api(`/shop/products/${product.id}/buy`, {
            method: 'POST',
            body: {quantity, requestKey: crypto.randomUUID()}
          });
        } catch (e) {
          setFailure(`${e.code || 'NETWORK_ERROR'}: ${e.message}`);
          return;
        }

        setReceipt({name: product.name, quantity, data});

        let synced = false;

        try {
          synced = await refresh();
        } catch {
          // 구매가 완료된 경우 결과는 유지한다.
        }

        notify(synced ? '구매 성공 · 전체 상태 갱신 완료' : '구매 성공 · 일부 조회 실패, 새로고침 필요');
      });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  const fixedQuantity = selectedProduct && (selectedProduct.recipe_id != null || selectedProduct.blood_pack_kind === 'FREE');
  const reason = purchaseReason(selectedProduct);
  const selectedTotal = totalPrice(selectedProduct);

  return (
      <section className="survival-shop" aria-labelledby="shop-title">
        <header className="shop-header">
          <div>
            <h2 id="shop-title">보급 상점</h2>
            <p>필요한 물자와 레시피를 구매할 수 있습니다.</p>
          </div>
          <div className="shop-header-right">
            <div className="shop-wallet">
              <small>보유 코인</small>
              <strong>{coinText(character?.currency)}</strong>
            </div>
            <button type="button" className="shop-refresh" disabled={busy || pending} onClick={() => run(refresh)}>상품 새로고침</button>
          </div>
        </header>

        {error && <p className="shop-notice" role="alert">상품 조회 실패: {error} · 이전 표시값일 수 있습니다.</p>}
        {character?.status === 'NEAR_DEATH' && <p className="shop-notice">빈사 상태에서도 상품과 레시피를 구매할 수 있습니다.</p>}
        {character?.status === 'DEAD' && <p className="shop-notice">사망 상태에서는 구매할 수 없습니다.</p>}
        {character?.in_active_battle && <p className="shop-notice">전투 중에는 상품을 구매할 수 없습니다.</p>}

        <div className="shop-workspace">
          <div className="shop-catalog">
            <div className="shop-catalog-heading">
              <h3>상품 진열대</h3>
              <span>판매 상품 {products.length}종</span>
            </div>

            <div className="shop-category-list" aria-label="상품 종류">
              {categories.map(item => (
                  <button key={item.id} type="button" className={category === item.id ? 'is-active' : ''} aria-pressed={category === item.id} onClick={() => {setCategory(item.id); setReceipt(null); setFailure('');}}>
                    {item.name}
                  </button>
              ))}
            </div>

            <div className="shop-search">
              <input type="search" value={query} placeholder="상품 이름 검색" aria-label="상품 이름 검색" onChange={event => setQuery(event.target.value)}/>
              <span>{visibleProducts.length}종 표시</span>
            </div>

            {visibleProducts.length > 0 ? (
                <div className="shop-product-grid">
                  {visibleProducts.map(product => {
                    const status = stockLabel(product);
                    const selected = String(selectedProduct?.id) === String(product.id);

                    return (
                        <button key={product.id} type="button" className={`shop-product-card${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={() => selectProduct(product.id)}>
                          <div className="shop-product-image-wrap">
                            <ProductImage key={`${product.id}:${product.image_url || ''}`} product={product}/>
                            {status && <span className="shop-product-status">{status}</span>}
                          </div>
                          <div className="shop-product-body">
                            <small>{typeLabel(product)}</small>
                            <strong className="shop-product-name">{product.name}</strong>
                            <p>{product.description || '상품 설명이 등록되지 않았습니다.'}</p>
                            <div className="shop-product-bottom">
                              <strong>{coinText(product.price)} <small>코인</small></strong>
                              <span>재고 {remainingText(product.globalRemaining)}</span>
                            </div>
                          </div>
                        </button>
                    );
                  })}
                </div>
            ) : (
                <div className="shop-empty">
                  {products.length ? '검색 조건에 맞는 상품이 없습니다.' : '현재 판매 중인 상품이 없습니다.'}
                </div>
            )}
          </div>

          <aside className="shop-checkout" aria-label="상품 구매">
            <div className="shop-checkout-heading">
              <h3>구매 명세</h3>
              <span>상품을 선택해 주세요</span>
            </div>

            {selectedProduct ? (
                <>
                  <div className="shop-checkout-product">
                    <ProductImage key={`${selectedProduct.id}:${selectedProduct.image_url || ''}`} product={selectedProduct} small/>
                    <div>
                      <small>{typeLabel(selectedProduct)}</small>
                      <h4>{selectedProduct.name}</h4>
                      <strong>{coinText(selectedProduct.price)} 코인</strong>
                    </div>
                  </div>

                  <p className="shop-checkout-description">{selectedProduct.description || '등록된 상품 설명이 없습니다.'}</p>

                  {selectedProduct.blood_pack_kind === 'FREE' && <p className="shop-checkout-info">무료 혈액팩 · 혈량 +10 · 캐릭터별 하루 1개 한정</p>}
                  {selectedProduct.blood_pack_kind === 'STANDARD' && <p className="shop-checkout-info">일반 혈액팩 · 혈량 +30 · 무료팩 일일 제한과 별개</p>}
                  {selectedProduct.recipe_id != null && <p className="shop-checkout-info">레시피 · {selectedProduct.learned ? '습득 완료' : '구매 즉시 습득'}</p>}

                  {selectedProduct.recipe_id != null && <section className="shop-recipe-detail" aria-label="레시피 상세">
                    <h4>필요 재료</h4>
                    {selectedProduct.recipe_detail?.ingredients?.length ? <ul>{selectedProduct.recipe_detail.ingredients.map(item => <li key={item.itemId}>{item.name} ×{item.quantity}</li>)}</ul> : <p>등록된 재료 정보가 없습니다.</p>}
                    <h4>완성 아이템</h4>
                    <p>{selectedProduct.recipe_detail?.resultName ? <>{selectedProduct.recipe_detail.resultName} ×{selectedProduct.recipe_detail.resultQuantity}</> : '등록된 완성 아이템 정보가 없습니다.'}</p>
                  </section>}
                  <div className="shop-stock-list">
                    <div><span>개인 구매 가능</span><strong>{remainingText(selectedProduct.personalRemaining)}</strong></div>
                    <div><span>전체 잔여 재고</span><strong>{remainingText(selectedProduct.globalRemaining)}</strong></div>
                    <div><span>오늘 구매 가능</span><strong>{remainingText(selectedProduct.dailyRemaining)}</strong></div>
                  </div>

                  <div className="shop-quantity">
                    <label htmlFor="shop-quantity-input">구매 수량</label>
                    {fixedQuantity ? (
                        <div className="shop-fixed-quantity">1개 {selectedProduct.blood_pack_kind === 'FREE' ? '· 일일 한정' : '· 레시피'}</div>
                    ) : (
                        <div className="shop-quantity-controls">
                          <button type="button" disabled={blocked} aria-label="구매 수량 감소" onClick={() => adjustQuantity(-1)}>−</button>
                          <input id="shop-quantity-input" inputMode="numeric" value={quantityOf(selectedProduct)} disabled={blocked} onChange={event => changeQuantity(event.target.value)}/>
                          <button type="button" disabled={blocked} aria-label="구매 수량 증가" onClick={() => adjustQuantity(1)}>+</button>
                        </div>
                    )}
                  </div>

                  <div className="shop-checkout-total">
                    <span>구매 합계</span>
                    <strong>{selectedTotal == null ? '—' : coinText(selectedTotal)} <small>코인</small></strong>
                  </div>

                  <button type="button" className="shop-buy-button" disabled={!!reason} onClick={() => buy(selectedProduct)}>
                    {Number(selectedProduct.price) === 0 ? '무료로 받기' : '구매하기'}
                  </button>
                  {reason && <p className="shop-buy-reason">{reason}</p>}
                </>
            ) : (
                <div className="shop-checkout-empty">선택 가능한 상품이 없습니다.</div>
            )}

            {failure && <p className="shop-failure" role="alert">{failure}</p>}

            {receipt && (
                <div className="shop-receipt" aria-live="polite">
                  <h4>구매 완료</h4>
                  <p>{receipt.name} × {receipt.quantity}</p>
                  {receipt.data.totalPrice != null && <p>결제 금액: {coinText(receipt.data.totalPrice)} 코인</p>}
                  {receipt.data.currency != null && <p>구매 후 잔액: {coinText(receipt.data.currency)} 코인</p>}
                  <details>
                    <summary>구매 처리 상세</summary>
                    <pre>{JSON.stringify(receipt.data, null, 2)}</pre>
                  </details>
                </div>
            )}
          </aside>
        </div>

        <p className="shop-footer-note">개인 구매 한도는 캐릭터별 전체 운영 기간의 누적 수량이며, 전체 재고는 모든 캐릭터가 공유합니다. 재고와 구매 가능 수량은 결제 시 서버에서 다시 확인합니다.</p>
      </section>
  );
}