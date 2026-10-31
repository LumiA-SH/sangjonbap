import {useRef, useState} from 'react';
import {api} from '../api/client';

export default function CookingPanel({catalog, character, error, busy, run, refresh, notify}) {
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState('');
  const sending = useRef(false);
  const blocked = busy || !catalog || !!error || !character || character.status === 'DEAD' || character.status === 'NEAR_DEATH';
  async function perform(path) {
    if (sending.current || blocked) return;
    sending.current = true;
    try {
      await run(async () => {
        setResult(null); setFailure('');
        try { setResult(await api(path, {method:'POST', body:{requestKey:crypto.randomUUID()}})); }
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
    {character?.status === 'NEAR_DEATH' && <p>빈사 상태에서는 요리·식사·습득이 불가합니다.</p>}
    <p>요리 AP {catalog?.cookingApCost ?? '조회 필요'} · 성공 {catalog?.successQuantity ?? '-'}개 / 실패 {catalog?.failureQuantity ?? '-'}개</p>
    <p>식사 {catalog?.dailyMealCount ?? '-'} / {catalog?.dailyMealLimit ?? '-'}회 · 일일 초기화 자동 실행은 현재 HOLD입니다.</p>
    <h3>레시피</h3>
    {catalog?.recipes.length === 0 && <p>등록된 레시피가 없습니다.</p>}
    <ul className="dev-list">{catalog?.recipes.map(recipe => <li className="dev-row" key={recipe.id}>
      <strong>{recipe.name}</strong><p>{recipe.description}</p>
      <p>습득 비용 {recipe.learn_cost} · 성공률 {recipe.success_rate}% · {recipe.learned ? '습득 완료' : '미습득'}</p>
      <p>재료: {recipe.ingredients.map(row => `${row.name} × ${row.quantity}`).join(', ')}</p>
      {recipe.result_quantity !== catalog.successQuantity && <p>레시피 성공 수량 설정 충돌: 서버 설정 확인 필요</p>}
      <div className="actions">
        <button disabled={blocked || recipe.learned} onClick={() => perform(`/cooking/recipes/${recipe.id}/learn`)}>습득</button>
        <button disabled={blocked || !recipe.learned || Number(character?.ap)<catalog.cookingApCost}
          onClick={() => perform(`/cooking/recipes/${recipe.id}/cook`)}>요리</button>
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
      <pre>{JSON.stringify(result,null,2)}</pre></div>}
  </section>;
}
