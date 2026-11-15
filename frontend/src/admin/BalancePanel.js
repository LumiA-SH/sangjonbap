import OperatingPolicyPanel from './OperatingPolicyPanel';
import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';

const labels = {
  heal_blood_cost: '치료 혈량 비용',
  heal_hp_recovery: '치료 HP 회복',
  investigation_ap_cost: '조사 AP 비용',
  cooking_ap_cost: '요리 1회 AP 비용',
  training_ap_cost: '훈련 AP 비용',
  training_currency_reward: '훈련 재화 보상',
  training_growth: '훈련 일반 성장량',
  training_great_growth: '훈련 대성공 성장량',
  training_great_rate_b: 'B 훈련 대성공 확률(%)',
  training_great_rate_a: 'A 훈련 대성공 확률(%)',
  training_great_rate_s: 'S 훈련 대성공 확률(%)'
};

export default function BalancePanel({onDenied,initialTab='foods'}) {
  const [settings, setSettings] = useState(null);
  const [tab,setTab]=useState(initialTab);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  function failed(e) {
    setMessage(`${e.code || 'BALANCE_FAILED'}: ${e.message}`);
    if (e.status === 401 || e.status === 403) onDenied(e.message);
  }

  async function load() {
    setBusy(true);

    try {
      setSettings((await api('/admin/balance')).settings);
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e) {
    e.preventDefault();
    if (saving.current) return;

    saving.current = true;
    setBusy(true);
    setMessage('');

    try {
      await api('/admin/balance', {
        method: 'PATCH',
        body: {settings, requestKey: crypto.randomUUID()}
      });

      await load();
      setMessage('저장 성공: 다음 요청부터 적용됩니다.');
    } catch (e) {
      failed(e);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
      <section className="admin-operations-page">
        
        <p>음식 등급별 혈량 회복량과 성장 확률을 이곳에서 관리합니다. 음식별 등급과 성장 대상은 음식 메뉴에서 선택합니다.</p>
        <div className="admin-guide-tabs" aria-label="공통 밸런스 분류"><button type="button" aria-pressed={tab==='foods'} onClick={()=>setTab('foods')}>음식 등급별 효과</button><button type="button" aria-pressed={tab==='actions'} onClick={()=>setTab('actions')}>행동 밸런스</button><button type="button" aria-pressed={tab==='policies'} onClick={()=>setTab('policies')}>운영 정책</button></div>
        {tab==='foods'?<FoodGradeSettings onDenied={onDenied}/>:tab==='policies'?<OperatingPolicyPanel onDenied={onDenied}/>:<>
        <button disabled={busy} onClick={load}>새로고침</button>
        

        {settings && (
            <form className="admin-form" onSubmit={save}>
              {[['치료',['heal_blood_cost','heal_hp_recovery']],['조사 · 요리',['investigation_ap_cost','cooking_ap_cost']],['일일훈련',['training_ap_cost','training_currency_reward','training_growth','training_great_growth','training_great_rate_b','training_great_rate_a','training_great_rate_s']]].map(([title,keys])=><fieldset className="admin-setting-card" key={title}><legend>{title}</legend>{keys.map(key => (
                  <label key={key}>
                    {labels[key]}
                    <input required type="number" min="0" max={key.includes('_rate_') ? 100 : 2147483647} step={key.includes('_rate_') ? 'any' : 1} disabled={busy} value={settings[key] ?? ''} onChange={e => setSettings({...settings, [key]: e.target.value === '' ? '' : Number(e.target.value)})}/>
                  </label>
              ))}</fieldset>)}
              <button disabled={busy}>설정 저장</button>
            </form>
        )}
        <p role="status">{message}</p></>}
      </section>
  );
}
export function FoodGradeSettings({onDenied}) {
 const [rows,setRows]=useState([]),[original,setOriginal]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const saving=useRef(false);
 useEffect(()=>{let live=true;setBusy(true);(async()=>{const all=[];let after=null;const seen=new Set();do{const data=await api('/admin/food-grades'+(after?'?after='+encodeURIComponent(after):''));all.push(...(data.records||[]).map(row=>({...row,blood_recovery:Number(row.blood_recovery),stat_growth_rate:Number(row.stat_growth_rate)})));after=data.nextAfter;if(after&&seen.has(after))throw Error('목록 페이지가 반복됩니다.');seen.add(after);}while(after);if(live){setRows(all);setOriginal(all);}})().catch(e=>{if(live){setMessage(e.message);if([401,403].includes(e.status))onDenied(e.message);}}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[onDenied]);
 const update=(index,key,value)=>setRows(current=>current.map((r,i)=>i===index?{...r,[key]:value}:r));
 async function save(event){event.preventDefault();if(saving.current)return;const changes=rows.filter(r=>!r.id||JSON.stringify(r)!==JSON.stringify(original.find(x=>x.id===r.id)));if(!changes.length){setMessage('변경된 설정이 없습니다.');return;}
 if(changes.some(r=>!r.name?.trim()||!Number.isInteger(r.blood_recovery)||r.blood_recovery<0||r.blood_recovery>100||typeof r.stat_growth_rate!=='number'||!Number.isFinite(r.stat_growth_rate)||r.stat_growth_rate<0||r.stat_growth_rate>100)){setMessage('등급명과 혈량 회복량(0~100 정수), 성장 확률(0~100)을 확인하세요.');return;}
 saving.current=true;setBusy(true);setMessage('');let saved=0;
 try{for(const r of changes){const {record}=await api('/admin/food-grades'+(r.id?'/'+r.id:''),{method:r.id?'PATCH':'POST',body:{name:r.name,blood_recovery:r.blood_recovery,stat_growth_rate:r.stat_growth_rate,is_active:r.is_active,requestKey:crypto.randomUUID()}});const next={...r,...record};setRows(current=>current.map(x=>(x===r||(r.id&&x.id===r.id))?next:x));setOriginal(current=>[...current.filter(x=>x.id!==next.id),next]);saved++;}setMessage('음식 등급 '+saved+'건 저장 완료');}
 catch(e){setMessage((saved?saved+'건 저장 완료 · 나머지 저장 실패: ':'저장 실패: ')+(e.code||'')+' '+e.message);if([401,403].includes(e.status))onDenied(e.message);}
 finally{saving.current=false;setBusy(false);}}
 return <section aria-label="음식 등급별 공통 효과"><form onSubmit={save}><header className="admin-editor-heading-actions"><h3>음식 등급별 공통 효과</h3><button disabled={busy}>음식 설정 저장</button></header><p>선택한 등급의 모든 음식에 공통 적용됩니다. 실패요리에는 수치 효과가 적용되지 않습니다.</p><div className="admin-balance-table-wrap"><table className="admin-balance-table"><thead><tr><th>음식 등급</th><th>혈량 회복량</th><th>능력치 성장 확률</th><th>활성</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.id||'new-'+i}><td><input aria-label={'음식 등급 '+(i+1)+' 이름'} required disabled={busy} value={r.name} onChange={e=>update(i,'name',e.target.value)}/></td>{[['blood_recovery','혈량 회복량'],['stat_growth_rate','성장 확률']].map(([key,label])=><td key={key}><input aria-label={r.name+' '+label} type="number" required min="0" max="100" step={key==='blood_recovery'?1:'any'} disabled={busy} value={r[key]??''} onChange={e=>update(i,key,e.target.value===''?'':Number(e.target.value))}/>{key==='stat_growth_rate'&&' %'}</td>)}<td><input aria-label={r.name+' 활성'} type="checkbox" checked={r.is_active!==false} disabled={busy} onChange={e=>update(i,'is_active',e.target.checked)}/></td></tr>)}</tbody></table></div>{!rows.length&&!busy&&<p>등록된 음식 등급이 없습니다.</p>}<button type="button" disabled={busy} onClick={()=>setRows(current=>[...current,{name:'',blood_recovery:0,stat_growth_rate:0,is_active:true}])}>등급 추가</button><details><summary>변경 전후 확인</summary><pre>{JSON.stringify({before:original,after:rows},null,2)}</pre></details><p role="status">{busy?'처리 중…':message}</p></form></section>;
}
