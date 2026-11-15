const titles={DAILY_TRAINING:'일일훈련',EAT_FOOD:'식사',COOK_RECIPE:'요리',INVESTIGATE:'조사',BATTLE_COMMAND:'전투',BATTLE_START:'마물 조우',BATTLE_MIDNIGHT_INTERRUPTED:'자정 전투 중단',BATTLE_TIMEOUT:'과거 전투 만료',COOK:'요리',EAT:'식사',MEAL:'식사',TRAIN:'일일훈련',TRAINING:'일일훈련',GACHA_DRAW:'보급품 뽑기',HEAL:'치료',HEAL_RECEIVE:'치료 받음',REVIVE:'부활',REVIVE_RECEIVE:'부활 받음',DEATH:'사망',ITEM_TRANSFER:'아이템 양도',ITEM_RECEIVE:'아이템 수령',COIN_TRANSFER:'코인 양도',COIN_RECEIVE:'코인 수령',STORAGE_DEPOSIT:'창고 보관',STORAGE_WITHDRAW:'창고 회수',SHOP_PURCHASE:'상점 구매',RECIPE_DISCOVERY:'레시피 최초 발견',RECIPE_LEARN:'레시피 학습',DICE_ROLL:'1D100',DAILY_RESET:'일일 초기화',TEST_DAILY_RESET_CHARACTER:'수동 일일 초기화'};
export const actionLabel=r=>titles[r.action_type]||r.description||'행동 기록';
export function actionSummary(r){
 const d=r.detail||{},parts=r.description?[r.description]:[];
 if(d.monsterName)parts.push(`상대: ${d.monsterName}`);
 if(d.endReason==='MIDNIGHT_INTERRUPTED'||r.action_type==='BATTLE_MIDNIGHT_INTERRUPTED')parts.push('자정 중단');
 else if(d.battleStatus||d.resolved?.status){
  const status=d.battleStatus||d.resolved.status;
  parts.push(status==='FLED'&&d.resolved?.fledActor?d.resolved.fledActor==='MONSTER'?'마물 도주':'캐릭터 도주':({VICTORY:'승리',DEFEAT:'패배',FLED:'도주',ACTIVE:'전투 진행'})[status]||'전투 결과');
 }
 if(d.result?.result_text||d.resultText)parts.push(d.result?.result_text||d.resultText);
 const rewards=Array.isArray(d.rewards)?d.rewards:Array.isArray(d.outputs)?d.outputs:d.reward&&typeof d.reward==='object'?[d.reward]:d.output?[d.output]:[];
 for(const item of rewards)parts.push(`${item.name||item.itemName||item.recipeName||'획득물'}${item.quantity!=null?' ×'+item.quantity:''}`);
 if(d.itemName)parts.push(`${d.itemName}${d.quantity!=null?' ×'+d.quantity:''}`);
 if(d.senderName||d.recipientName)parts.push(`${d.senderName||'양도자'} → ${d.recipientName||'수령자'}`);
 for(const [key,label]of [['hp','HP'],['blood','혈량'],['ap','AP'],['currency','코인']]){
  const before=d.before?.[key]??d[key+'Before']??d[key+'_before'],after=d.after?.[key]??d[key+'After']??d[key+'_after']??d[key]??d.resolved?.[key];
  if(before!=null&&after!=null&&typeof before!=='object'&&typeof after!=='object')parts.push(`${label} ${before} → ${after}`);
 }
 for(const [role,label] of [['provider','시전자'],['target','대상']]){
  for(const [key,unit] of [['hp','HP'],['blood','혈량'],['ap','AP']]){
   const b=d.before?.[role]?.[key],a=d.after?.[role]?.[key];
   if(b!=null&&a!=null&&b!==a)parts.push(`${label} ${unit} ${b} → ${a}`);
  }
 }
 if(typeof d.reward==='number')parts.push(`코인 +${d.reward}`);
 if(d.dailyMealCount!=null)parts.push(`오늘 식사 ${d.dailyMealCount}/${d.dailyMealLimit??5}`);
 if(Number.isInteger(d.successCount)&&Number.isInteger(d.failureCount))parts.push(`요리 성공 ${d.successCount}회 · 실패 ${d.failureCount}회`);
 if(d.successCount==null&&d.succeeded!=null)parts.push(d.succeeded?'요리 성공':'실패 요리');
 if(d.quantity!=null&&String(r.action_type).startsWith('COIN_'))parts.push(`코인 ${d.quantity}`);
 if(d.currencyReward!=null)parts.push(`코인 +${d.currencyReward}`);
 const growth=d.growth;if(growth?.stat)parts.push(`${String(growth.stat).toUpperCase()} +${growth.amount??growth.growth??1}`);
 if(d.rpEffectText)parts.push(d.rpEffectText);
 return parts.join(' · ')||r.description||r.result_text||r.content||'기존 기록에 상세 결과가 없습니다.';
}
