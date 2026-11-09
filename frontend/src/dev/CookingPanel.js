import {useRef, useState} from 'react';
import {api} from '../api/client';

export default function CookingPanel({catalog, inventory = [], activeBattle, battleError, character, error, busy, run, refresh, notify}) {
  const [result, setResult] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [failure, setFailure] = useState('');
  const sending = useRef(false);
  const blocked = busy || !catalog || !!error || !character || character.status === 'DEAD' || activeBattle || !!battleError;
  const craftBlocked = blocked || character?.status === 'NEAR_DEATH';
  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= (catalog?.maxBatchQuantity ?? 1000);
  async function perform(path, craft = false) {
    if (sending.current || blocked || (craft && craftBlocked) || (path.endsWith('/cook') && !validQuantity)) return;
    sending.current = true;
    try {
      await run(async () => {
        setResult(null); setFailure('');
        try { setResult(await api(path, {method:'POST', body:{requestKey:crypto.randomUUID(),...(path.endsWith('/cook')?{quantity}:{})}})); }
        catch (e) { setFailure(`${e.code || 'NETWORK_ERROR'}: ${e.message}`); return; }
        let synced = false;
        try { synced = await refresh(); } catch { /* Action has already committed. */ }
        notify(synced ? '처리 완료 · 전체 상태 갱신 완료' : '처리 완료 · 일부 조회 실패, 새로고침 필요');
      });
    } finally { sending.current = false; }
  }
  return <section aria-labelledby="cooking-title">
    <span className="badge">COOKING / MEAL</span><h2 id="cooking-title">요리·식사 DEV</h2>
    <button disabled={busy} onClick={() => run(refresh)}>레시피·음식 새로고침</button>
    {error && <p role="alert">조회 실패: {error} · 이전 값일 수 있습니다.</p>}
    {character?.status === 'DEAD' && <p>DEAD 행동 불가</p>}
    {character?.status === 'NEAR_DEATH' && <p>빈사 상태에서는 식사와 레시피 구매가 가능하며 요리는 불가합니다.</p>}
    <p>요리 AP {catalog?.cookingApCost ?? '조회 필요'} · 성공 수량은 레시피별 설정 · 실패 {catalog?.failureQuantity ?? '-'}개</p>
    <p>식사 {catalog?.dailyMealCount ?? '-'} / {catalog?.dailyMealLimit ?? '-'}회 · 일일 초기화 자동 실행은 현재 HOLD입니다.</p>
    {activeBattle && <p>전투 중에는 요리·식사·습득을 할 수 없습니다.</p>}
    {battleError && <p role="alert">전투 상태 확인 실패: {battleError}</p>}
    <label>제작 시도 수 <input type="number" min="1" max={catalog?.maxBatchQuantity ?? 1000} value={quantity} disabled={busy} onChange={e=>setQuantity(e.target.value===''?'':Number(e.target.value))}/></label>
    <p>필요 AP: {validQuantity && catalog ? quantity*catalog.cookingApCost : '수량 확인 필요'} · 재료는 전량 성공할 수 있는 수량을 보유해야 하며 실제 결과만큼 소모됩니다.</p>
    <h3>레시피</h3>
    {catalog?.recipes.length === 0 && <p>등록된 레시피가 없습니다.</p>}
    <ul className="dev-list">{catalog?.recipes.map(recipe => <li className="dev-row" key={recipe.id}>
      <strong>{recipe.name}</strong><p>{recipe.description}</p>
      <p>상점 가격 {recipe.shop_price ?? '미등록'} · 성공률 {recipe.success_rate}% · 성공 {recipe.result_quantity}개 · {recipe.learned ? '습득 완료' : '미습득'}</p>
      <p>재료: {recipe.ingredients.map(row => `${row.name} × ${validQuantity ? row.quantity*quantity : '-'} (보유 ${inventory.find(i=>String(i.item_id ?? i.itemId)===String(row.itemId))?.quantity ?? 0})`).join(', ')}</p>
      <div className="actions">
        <button disabled={blocked || recipe.learned || !recipe.shop_product_id} onClick={() => perform(`/cooking/recipes/${recipe.id}/learn`)}>습득</button>
        <button disabled={craftBlocked || !validQuantity || !recipe.learned || Number(character?.ap)<catalog.cookingApCost*quantity}
          onClick={() => perform(`/cooking/recipes/${recipe.id}/cook`, true)}>요리</button>
      </div>
    </li>)}</ul>
    <h3>보유 음식</h3>
    {catalog?.foods.length === 0 && <p>먹을 수 있는 보유 음식이 없습니다.</p>}
    <ul className="dev-list">{catalog?.foods.map(food => <li className="dev-row" key={food.item_id}>
      <strong>{food.name} × {food.quantity}</strong>
      <p>혈량 +{food.blood_recovery} · {food.stat_growth_enabled ? `${food.stat_growth_target} +${food.stat_growth_value} (${food.stat_growth_rate}%)` : '성장 없음'}</p>
      <button disabled={blocked || catalog.dailyMealCount>=catalog.dailyMealLimit}
        onClick={() => perform(`/cooking/foods/${food.item_id}/eat`)}>식사</button>
    </li>)}</ul>
    {failure && <p role="alert">{failure}</p>}
    {result && <div className="dev-result"><h3>처리 결과</h3>
      {typeof result.succeeded === 'boolean' && <p>요리 {result.succeeded ? '성공' : '실패'} · 재료/AP 소모와 지급이 반영되었습니다.</p>}
      {result.quantity != null && <p>요청 {result.quantity}회 · 성공 {result.successCount}회 / 실패 {result.failureCount}회 · AP {result.apCost} 소모</p>}
      {result.outputs?.map(row=><p key={row.itemId}>{row.name || `음식 ID ${row.itemId}`} × {row.quantity} 지급</p>)}
      {result.rpEffectText&&<p>RP 효과: {result.rpEffectText}</p>}
      <pre>{JSON.stringify(result,null,2)}</pre></div>}
  </section>;
}
