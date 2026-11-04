import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';

const labels={heal_blood_cost:'치료 혈량 비용',heal_hp_recovery:'치료 HP 회복',investigation_ap_cost:'조사 AP 비용',cooking_ap_cost:'요리 1회 AP 비용',training_ap_cost:'훈련 AP 비용',training_currency_reward:'훈련 재화 보상',training_growth:'훈련 일반 성장량',training_great_growth:'훈련 대성공 성장량',training_great_rate_b:'B 훈련 대성공 확률(%)',training_great_rate_a:'A 훈련 대성공 확률(%)',training_great_rate_s:'S 훈련 대성공 확률(%)'};
export default function BalancePanel({onDenied}) {
  const [settings,setSettings]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const saving=useRef(false);
  function failed(e){setMessage(`${e.code||'BALANCE_FAILED'}: ${e.message}`);if(e.status===401||e.status===403)onDenied(e.message);}
  async function load(){setBusy(true);try{setSettings((await api('/admin/balance')).settings);}catch(e){failed(e);}finally{setBusy(false);}}
  useEffect(()=>{load();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(e){
    e.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setMessage('');
    try{await api('/admin/balance',{method:'PATCH',body:{settings,requestKey:crypto.randomUUID()}});await load();setMessage('저장 성공: 다음 요청부터 적용됩니다.');}
    catch(e){failed(e);}finally{saving.current=false;setBusy(false);}
  }
  return <section><h2>공통 밸런스</h2><p>혈액팩은 아이템, 이능 전투 비용은 PVE 설정, 음식·요리·가챠는 각 관리 메뉴에서 설정합니다.</p>
    <button disabled={busy} onClick={load}>새로고침</button><p role="status">{message}</p>
    {settings&&<form className="admin-form" onSubmit={save}>{Object.entries(labels).map(([key,label])=><label key={key}>{label}<input required type="number" min="0" max={key.includes('_rate_')?100:2147483647} step={key.includes('_rate_')?'any':1} disabled={busy} value={settings[key]??''} onChange={e=>setSettings({...settings,[key]:e.target.value===''?'':Number(e.target.value)})}/></label>)}<button disabled={busy}>설정 저장</button></form>}
  </section>;
}
