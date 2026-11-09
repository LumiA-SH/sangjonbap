import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';

const labels={ATTACK:'일반공격',DEFEND:'방어',ABILITY:'이능공격',ITEM:'아이템 사용',FLEE:'도주',BLOCK_FLEE:'도주차단'};
export default function BattlePanel({inventory=[],busy,run,refresh,revision=0}) {
  const [imageFailed,setImageFailed]=useState(false);
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[itemId,setItemId]=useState('');
  const sending=useRef(false),request=useRef(null);
  async function load() {
    const token={};request.current=token;setLoading(true);setError('');
    try {const current=await api('/battles/latest');if(request.current===token)setData(current);}
    catch(e){if(request.current===token){setData(null);setError(`${e.code||'BATTLE_FAILED'}: ${e.message}`);}}
    finally{if(request.current===token)setLoading(false);}
  }
  useEffect(()=>{load();return()=>{request.current=null;};},[revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>setImageFailed(false),[data?.battle?.monster?.image_url]);
  const battle=data?.battle,active=battle?.battle_status==='ACTIVE';
  const items=inventory.filter(item=>item.battle_usable&&item.usable&&item.effect_type==='BLOOD_PACK'&&Number(item.quantity)>0);
  const reason=action=>{
    if(!active)return '종료된 전투입니다.';
    if(data.character.status==='DEAD'||Number(data.character.hp)<=0)return '사망 상태에서는 행동할 수 없습니다.';
    if(data.character.status==='NEAR_DEATH'||Number(data.character.blood)<=0)return '혈량 0의 빈사 상태입니다. 전투 상태를 새로고침하세요.';
    if(action==='ABILITY'){
      if(!data.character.has_ability||!data.character.ability_grade)return '이능을 보유하지 않았습니다.';
      const cost=battle.abilityApCosts?.[data.character.ability_grade];
      if(!Number.isInteger(cost))return '필요 AP 정보를 확인할 수 없습니다. 새로고침하세요.';
      if(Number(data.character.ap)<cost)return `AP 부족: 필요 ${cost}, 현재 ${data.character.ap}`;
    }
    if(action==='ITEM'&&!items.some(i=>String(i.item_id)===itemId))return '사용할 혈액팩을 선택하세요.';
    return '';
  };
  const imageUrl=battle?.monster?.image_url;
  const safeImage=typeof imageUrl==='string'&&/^(https?:\/\/|\/(?!\/))/.test(imageUrl);
  async function command(action) {
    if(sending.current||busy||loading||!active||!battle.options.includes(action)||reason(action))return;
    sending.current=true;
    try {await run(async()=>{
      setError('');
      try {
        const result=await api(`/battles/${battle.id}/commands`,{method:'POST',body:{requestKey:crypto.randomUUID(),turnNo:battle.turn_no,action,...(action==='ITEM'?{itemId}:{})}});
        setData({...result,logs:[]});
        await refresh();await load();
      } catch(e){await load();setError(`${e.code||'BATTLE_FAILED'}: ${e.message}`);}
    });} finally{sending.current=false;}
  }
  return <section id="battle-panel" aria-label="일반 PVE 전투">
    <h2>일반 PVE 전투</h2>
    <button disabled={busy||loading} onClick={load}>전투 새로고침</button>
    {loading&&<p role="status">전투 상태 확인 중…</p>}{error&&<p role="alert">{error}</p>}
    {!loading&&!battle&&!error&&<p>조사 중 마물과 조우하면 전투가 시작됩니다.</p>}
    {battle&&<>
      {safeImage&&!imageFailed?<img src={imageUrl} alt={battle.monster?.name||'마물'} onError={()=>setImageFailed(true)} style={{maxWidth:'100%',width:240,height:'auto'}}/>:<p role="img" aria-label="마물 이미지 없음">마물 이미지가 없습니다.</p>}
      <h3>{battle.monster?.name||`마물 ${battle.monster_id}`} · 전투 {battle.id}</h3>
      <p>상태 {battle.battle_status} · 턴 {battle.turn_no} · 종료 사유 {battle.end_reason||'-'}</p>
      <p>HP {data.character.hp}/{data.character.max_hp} · 혈량 {data.character.blood}/{Math.min(100,data.character.max_blood)} · AP {data.character.ap}/{data.character.max_ap}</p>
      <p>마물 HP {battle.monster_hp}/{battle.monster_max_hp}</p>
      {active&&<>
        <p>마물 행동 예고: {battle.declaration?.name} ({battle.declaration?.action_type})</p>
        <p>마지막 정상 행동: {battle.last_command_at||battle.started_at} · 24시간 무행동 시 패배. 새로고침은 시간을 연장하지 않습니다.</p>
        <label>전투 아이템<select value={itemId} disabled={busy||loading} onChange={e=>setItemId(e.target.value)}>
          <option value="">혈액팩 선택</option>{items.map(item=><option key={item.item_id} value={item.item_id}>{item.name} × {item.quantity}</option>)}
        </select></label>
        <div className="actions">{battle.options.map(action=><button key={action}
          disabled={busy||loading||!!reason(action)} title={reason(action)}
          onClick={()=>command(action)}>{labels[action]||action}</button>)}</div>
        <ul aria-label="행동 불가 사유">{battle.options.filter(a=>reason(a)).map(a=><li key={a}>{labels[a]}: {reason(a)}</li>)}</ul>
      </>}
      {!active&&<div aria-label="전투 결과"><h3>전투 결과</h3><p>{{VICTORY:'승리',DEFEAT:'패배',FLED:'도주'}[battle.battle_status]||battle.battle_status}</p>
        {battle.battle_status==='VICTORY'&&Number(battle.character_hp??data.character.hp)===0&&<p role="status">동귀어진: 전투는 승리했지만 PC는 사망했습니다. 처치 보상은 정상 지급됩니다.</p>}
        <p>현재 캐릭터 상태: {{ALIVE:'생존',NEAR_DEATH:'빈사',DEAD:'사망'}[data.character.status]||data.character.status||'-'} · 마물 처치: {battle.battle_status==='VICTORY'?'예':'아니오'}</p><p>지급 재화: {data.currencyReward||0}</p>
        <ul>{(data.rewards||[]).map((reward,i)=><li key={i}>{reward.name||`아이템 ${reward.itemId}`} {reward.recipeId?'레시피 무료 습득':`× ${reward.quantity}`}{reward.guaranteed?' · 식재료 보장':''}</li>)}</ul>
      </div>}
      <h3>전투 로그 (최근 100건)</h3><ol>{(data.logs||[]).map(log=><li key={log.id}>턴 {log.turn_no} · {log.actor_type} · {log.action_type} · {log.message} · 피해 {log.damage??'-'}</li>)}</ol>
    </>}
  </section>;
}
