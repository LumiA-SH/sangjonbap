const labels={DICE:'주사위',NONE:'없음',SELF:'자신',OTHER:'다른 대상',ALL:'전체',ALIVE:'생존',NEAR_DEATH:'빈사',DEAD:'사망',ACTIVE:'진행 중',VICTORY:'승리',DEFEAT:'패배',FLED:'종료 · 도주',PENDING:'대기',SENT:'발송 완료',FAILED:'실패',ADMIN:'관리자',USER:'일반 사용자',MASTODON:'마스토돈 로그인',DEV:'개발용 인증',HOLD:'보류',PREVIEW_ONLY:'미리보기만',public:'전체 공개',unlisted:'타임라인 비노출',private:'팔로워 공개',ATTACK:'일반 공격',SPECIAL_ATTACK:'특수 공격',FLEE:'도주',ATK:'공격력',DEF:'방어력',AGI:'민첩',atk:'공격력',def:'방어력',agi:'민첩',hp:'HP',max_hp:'최대 HP',BATTLE:'전투',SHOP:'상점',TRAINING:'훈련',CHARACTER:'캐릭터',ITEM:'아이템',INVESTIGATION:'조사',RECIPE:'레시피',INVENTORY:'인벤토리',COOKING:'요리',GACHA:'가챠',AREA:'구역',MONSTER:'마물',CLUE:'단서',STORAGE:'공용창고',FOOD:'음식',SYSTEM:'시스템',BLOOD_PACK:'혈액팩',FIXED_DAMAGE:'고정 피해',STUN:'기절',POISON:'중독',SMOKE:'도주 보조'};
export function displayLabel(value){
 const ability=/^battle_ability_([edcbas])_(multiplier|ap_cost)$/.exec(value||'');
 if(ability)return ability[1].toUpperCase()+'등급 이능 '+(ability[2]==='multiplier'?'공격 배율':'AP 비용');
 return labels[value]||value||'미설정';
}

