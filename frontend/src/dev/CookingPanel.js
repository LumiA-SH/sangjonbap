import {statName} from './actionPresentation';
import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import './CookingPanel.css';

export default function CookingPanel({catalog, inventory = [], activeBattle, battleError, character, error, busy, run, refresh, notify}) {
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [result, setResult] = useState(null);
  const [lastAction, setLastAction] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [failure, setFailure] = useState('');
  const sending = useRef(false);
  const resultRef = useRef(null);

  useEffect(() => {
    if (result) resultRef.current?.focus({preventScroll: true});
  }, [result]);

  const recipes = catalog?.recipes || [];
  const foods = catalog?.foods || [];
  const selectedRecipe = recipes.find(recipe => String(recipe.id) === selectedRecipeId) || recipes[0] || null;
  const maxBatchQuantity = catalog?.maxBatchQuantity ?? 1000;
  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= maxBatchQuantity;
  const requiredAp = validQuantity && catalog ? quantity * catalog.cookingApCost : null;
  const mealCount = catalog?.dailyMealCount;
  const mealLimit = catalog?.dailyMealLimit;
  const mealBlocked = catalog && mealCount >= mealLimit;

  const blocked = busy || !catalog || !!error || !character || character.status === 'DEAD' || activeBattle || !!battleError;
  const craftBlocked = blocked || character?.status === 'NEAR_DEATH';

  function ownedQuantity(itemId) {
    return Number(inventory.find(item => String(item.item_id ?? item.itemId) === String(itemId))?.quantity ?? 0);
  }

  async function perform(path, craft = false, action = '') {
    if (sending.current || blocked || (craft && craftBlocked) || (path.endsWith('/cook') && !validQuantity)) return;

    sending.current = true;

    try {
      await run(async () => {
        setResult(null);
        setFailure('');

        try {
          const data = await api(path, {
            method: 'POST',
            body: {requestKey: crypto.randomUUID(), ...(path.endsWith('/cook') ? {quantity} : {})}
          });

          setResult(data);
          setLastAction(action);
        } catch (e) {
          setFailure(`${e.code || 'NETWORK_ERROR'}: ${e.message}`);
          return;
        }

        let synced = false;

        try {
          synced = await refresh();
        } catch {
          // 이미 처리된 결과는 그대로 유지한다.
        }

        notify(synced ? '처리 완료 · 전체 상태 갱신 완료' : '처리 완료 · 일부 조회 실패, 새로고침 필요');
      });
    } finally {
      sending.current = false;
    }
  }

  return (
      <section className="survival-cooking" aria-labelledby="cooking-title">
        <header className="cooking-header">
          <div className="cooking-heading">
            <h2 id="cooking-title">요리·식사</h2>
            <p>레시피를 선택해 음식을 만들고, 보유한 음식을 먹을 수 있습니다.</p>
          </div>
          <button type="button" disabled={busy} onClick={() => run(refresh)}>레시피·음식 새로고침</button>
        </header>

        <div className="cooking-overview">
          <div><small>요리 1회 AP</small><strong>{catalog?.cookingApCost ?? '—'}</strong></div>
          <div><small>현재 AP</small><strong>{character?.ap ?? '—'}</strong></div>
          <div><small>오늘 식사</small><strong>{mealCount ?? '—'} <span>/ {mealLimit ?? '—'}회</span></strong></div>
        </div>

        {error && <p className="cooking-notice" role="alert">조회 실패: {error} · 이전 표시값일 수 있습니다.</p>}
        {battleError && <p className="cooking-notice" role="alert">전투 상태 확인 실패: {battleError}</p>}
        {activeBattle && <p className="cooking-notice">전투 중에는 요리·식사·습득을 할 수 없습니다.</p>}
        {character?.status === 'DEAD' && <p className="cooking-notice">사망 상태에서는 행동할 수 없습니다.</p>}
        {character?.status === 'NEAR_DEATH' && <p className="cooking-notice">빈사 상태에서는 식사와 레시피 구매가 가능하며 요리는 불가합니다.</p>}

        <div className="cooking-workspace">
          <aside className="cooking-recipes" aria-label="레시피 목록">
            <div className="cooking-recipes-heading">
              <h3>레시피</h3>
              <span>{recipes.length}개</span>
            </div>

            <div className="cooking-recipe-list">
              {recipes.map(recipe => (
                  <button key={recipe.id} type="button" className={`cooking-recipe-item${String(selectedRecipe?.id) === String(recipe.id) ? ' is-selected' : ''}`} aria-pressed={String(selectedRecipe?.id) === String(recipe.id)} onClick={() => setSelectedRecipeId(String(recipe.id))}>
                    <span className="cooking-recipe-name">{recipe.name}</span>
                    <span className="cooking-recipe-meta">
                                    <small>{recipe.learned ? '습득 완료' : '미습득'}</small>
                                    <small>성공률 {recipe.success_rate}%</small>
                                </span>
                  </button>
              ))}

              {recipes.length === 0 && <p className="cooking-recipe-empty">등록된 레시피가 없습니다.</p>}
            </div>
          </aside>

          <section className="cooking-station" aria-label="선택한 레시피 조리">
            <div className="cooking-station-heading">
              <h3>조리대</h3>
              {selectedRecipe && <span className={selectedRecipe.learned ? 'is-learned' : ''}>{selectedRecipe.learned ? '습득 완료' : '미습득 레시피'}</span>}
            </div>

            {selectedRecipe ? (
                <>
                  <div className="cooking-recipe-detail">
                    <h4>{selectedRecipe.name}</h4>
                    <p>{selectedRecipe.description || '등록된 레시피 설명이 없습니다.'}</p>
                  </div>

                  <div className="cooking-recipe-stats">
                    <div><small>조리 성공률</small><strong>{selectedRecipe.success_rate}%</strong></div>
                    <div><small>성공 시 제작</small><strong>{selectedRecipe.result_quantity}개</strong></div>
                    <div><small>레시피 가격</small><strong>{selectedRecipe.shop_price ?? '미등록'}</strong></div>
                  </div>

                  <div className="cooking-ingredients">
                    <div className="cooking-section-heading">
                      <h4>필요 재료</h4>
                      <span>{validQuantity ? `${quantity}회 제작 기준` : '제작 수량 확인 필요'}</span>
                    </div>

                    {selectedRecipe.ingredients.length > 0 ? (
                        <ul>
                          {selectedRecipe.ingredients.map(ingredient => {
                            const owned = ownedQuantity(ingredient.itemId);
                            const required = validQuantity ? Number(ingredient.quantity) * quantity : null;
                            const enough = required != null && owned >= required;

                            return (
                                <li key={ingredient.itemId}>
                                  <span>{ingredient.name}</span>
                                  <span className="cooking-ingredient-quantity">
                                                        필요 <strong>{required ?? '—'}</strong>
                                                        <small className={required != null && !enough ? 'is-insufficient' : ''}>보유 {owned}</small>
                                                    </span>
                                </li>
                            );
                          })}
                        </ul>
                    ) : <p className="cooking-ingredient-empty">등록된 재료가 없습니다.</p>}
                  </div>

                  <div className="cooking-quantity">
                    <label htmlFor="cooking-batch-quantity">제작 시도 수</label>
                    <div className="cooking-quantity-row">
                      <input id="cooking-batch-quantity" type="number" min="1" max={maxBatchQuantity} value={quantity} disabled={busy} onChange={e => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}/>
                      <div>
                        <small>필요 AP</small>
                        <strong>{requiredAp ?? '수량 확인 필요'}</strong>
                      </div>
                    </div>
                    <p>전량 성공에 필요한 재료를 보유해야 하며, 실제 결과에 따라 재료가 소모됩니다.</p>
                  </div>

                  <div className="cooking-station-actions">
                    <button type="button" className="cooking-learn-button" disabled={blocked || selectedRecipe.learned || !selectedRecipe.shop_product_id} onClick={() => perform(`/cooking/recipes/${selectedRecipe.id}/learn`, false, '레시피 습득')}>
                      {selectedRecipe.learned ? '습득 완료' : '레시피 습득'}
                    </button>
                    <button type="button" className="cooking-craft-button" disabled={craftBlocked || !validQuantity || !selectedRecipe.learned || Number(character?.ap) < requiredAp} onClick={() => perform(`/cooking/recipes/${selectedRecipe.id}/cook`, true, '요리')}>
                      요리하기
                    </button>
                  </div>

                  <p className="cooking-station-note">요리 실패 시에도 설정된 실패 음식이 지급됩니다. 실패 수량: {catalog?.failureQuantity ?? '—'}개</p>
                </>
            ) : (
                <div className="cooking-station-empty">
                  <strong>조리할 레시피가 없습니다.</strong>
                  <p>레시피를 습득하면 이곳에서 요리할 수 있습니다.</p>
                </div>
            )}
          </section>
        </div>

        <section className="cooking-meals">
          <div className="cooking-section-heading">
            <div>
              <h3>보유 음식</h3>
              <p>음식을 먹으면 설정된 혈량 회복과 능력치 성장 효과가 적용됩니다.</p>
            </div>
            <span>오늘 식사 {mealCount ?? '—'} / {mealLimit ?? '—'}회</span>
          </div>

          {foods.length > 0 ? (
              <div className="cooking-food-list">
                {foods.map(food => (
                    <article className="cooking-food-card" key={food.item_id}>
                      <div className="cooking-food-heading">
                        <h4>{food.name}</h4>
                        <span>보유 {food.quantity}개</span>
                      </div>

                      <div className="cooking-food-effects">
                        <span>혈량 회복 <strong>+{food.blood_recovery}</strong></span>
                        {food.stat_growth_enabled ? (
                            <span>{statName(food.stat_growth_target)} <strong>+{food.stat_growth_value}</strong> · 성장 확률 {food.stat_growth_rate}%</span>
                        ) : <span>{food.effective_failure ? '실패 음식' : '능력치 성장 없음'}</span>}
                      </div>

                      <button type="button" disabled={blocked || mealBlocked} onClick={() => perform(`/cooking/foods/${food.item_id}/eat`, false, `${food.name} 섭취`)}>
                        식사하기
                      </button>
                    </article>
                ))}
              </div>
          ) : <p className="cooking-food-empty">현재 먹을 수 있는 보유 음식이 없습니다.</p>}
        </section>

        {failure && <p className="cooking-notice" role="alert">{failure}</p>}

        {result && (
            <section ref={resultRef} tabIndex={-1} className="cooking-result" aria-label="요리 및 식사 처리 결과" aria-live="polite">
              <div className="cooking-result-heading">
                <div>
                  <span>처리 완료</span>
                  <h3>{lastAction} 결과</h3>
                </div>
              </div>

              {typeof result.succeeded === 'boolean' && (
                  <p className="cooking-result-summary">요리 {result.succeeded ? '성공' : '실패'} · 재료와 AP 소모 및 지급 결과가 반영되었습니다.</p>
              )}

              {result.quantity != null && (
                  <p className="cooking-result-summary">요청 {result.quantity}회 · 성공 {result.successCount}회 / 실패 {result.failureCount}회 · AP {result.apCost} 소모</p>
              )}

              {result.outputs?.length > 0 && (
                  <div className="cooking-result-outputs">
                    <h4>획득한 음식</h4>
                    <ul>{result.outputs.map(row => <li key={row.itemId}>{row.name || `음식 ID ${row.itemId}`} × {row.quantity}</li>)}</ul>
                  </div>
              )}

              {result.bloodBefore != null && <p className="cooking-result-summary">혈량 회복 +{result.blood - result.bloodBefore} · {result.bloodBefore} → {result.blood}</p>}
              {result.growth && <p className="cooking-result-summary">능력치 성장 성공 · {statName(result.growth.stat)} +{result.growth.after - result.growth.before} ({result.growth.before} → {result.growth.after})</p>}
              {result.bloodBefore != null && !result.growth && <p className="cooking-result-summary">능력치 성장 없음</p>}
              {result.rpEffectText && <p className="cooking-result-story">{result.rpEffectText}</p>}

              <details className="cooking-result-technical">
                <summary>상세 처리 응답 확인</summary>
                <pre>{JSON.stringify(result, null, 2)}</pre>
              </details>
            </section>
        )}
      </section>
  );
}