/* global BigInt */
import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';
import ItemPicker from './ItemPicker';

const defaults={
  foods:{item_id:'',blood_recovery:0,stat_growth_enabled:false,stat_growth_rate:0,stat_growth_target:null,stat_growth_value:0,rp_effect_text:null},
  recipes:{name:'',description:null,learn_cost:0,success_rate:100,result_item_id:'',failure_item_id:null,is_active:true,ingredients:[]},
  gachas:{name:'',price:0,is_active:true,start_at:null,end_at:null,rewards:[]}
};
const labels={item_id:'아이템 ID',blood_recovery:'혈량 회복',stat_growth_enabled:'성장 활성',stat_growth_rate:'성장 확률 (%)',stat_growth_target:'고정 성장 스탯',stat_growth_value:'성장량',rp_effect_text:'RP 효과 설명',name:'이름',description:'설명',learn_cost:'습득 비용',success_rate:'성공 확률 (%)',result_item_id:'성공 음식 ID',failure_item_id:'실패 음식 ID (선택)',is_active:'활성',price:'가격',start_at:'시작 시각 (시간대 포함 ISO)',end_at:'종료 시각 (시간대 포함 ISO)'};
const numeric=['blood_recovery','stat_growth_rate','stat_growth_value','learn_cost','success_rate','price'];
const isId=value=>/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
export function validateDraft(kind,draft) {
  for (const [key,value] of Object.entries(draft)) {
    if (numeric.includes(key) && (typeof value!=='number'||!Number.isFinite(value)||value<0||value>2147483647||(!key.endsWith('rate')&&!Number.isInteger(value)))) return `${labels[key]} 값을 확인하세요.`;
    if (key.endsWith('rate')&&(value>100||Number(value.toFixed(2))!==value)) return '확률은 소수 둘째 자리까지의 0~100입니다.';
    if (key.endsWith('item_id') && !(key==='failure_item_id'&&value===null) && !isId(value)) return '아이템 ID는 양의 정수입니다.';
  }
  if ('name' in draft && (!draft.name.trim()||[...draft.name].length>100)) return '이름은 1~100자입니다.';
  if (kind==='foods' && (draft.stat_growth_enabled ? !draft.stat_growth_target||draft.stat_growth_value<=0 : draft.stat_growth_target!==null||draft.stat_growth_value!==0)) return '성장 활성: 대상과 양수 성장량 / 비활성: 대상 NULL과 성장량 0';
  const children=draft.ingredients||draft.rewards;
  if (children) {
    if (!children.length) return '재료/보상을 한 개 이상 등록하세요.';
    if (children.some(r=>!isId(r.item_id)||!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>2147483647||('weight' in r&&(!Number.isInteger(r.weight)||r.weight<1||r.weight>2147483647)))) return '재료/보상의 ID, 양수 정수 수량과 가중치를 확인하세요.';
    if (kind==='recipes'&&new Set(children.map(r=>r.item_id)).size!==children.length) return '재료를 중복 등록할 수 없습니다.';
  }
  if (kind==='recipes'&&draft.success_rate<100&&!draft.failure_item_id) return '실패 가능한 레시피에는 실패 음식이 필요합니다.';
  for (const key of ['start_at','end_at']) if (draft[key] && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(draft[key])||!Number.isFinite(Date.parse(draft[key])))) return '시각은 2026-10-11T00:00:00+09:00 형식입니다.';
  const micros=value=>BigInt(Date.parse(value))*1000n+BigInt((value.match(/\.(\d+)/)?.[1]||'').padEnd(6,'0').slice(3,6));
  if (draft.start_at&&draft.end_at&&micros(draft.end_at)<=micros(draft.start_at)) return '종료 시각은 시작 시각 이후여야 합니다.';
  return '';
}
function MasterEditor({kind,record,onSaved,onDenied,onBusy}) {
  const [draft,setDraft]=useState(()=>Object.fromEntries(Object.entries(defaults[kind]).map(([k,v])=>[k,record?.[k]??v])));
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const saving=useRef(false);
  const child=kind==='recipes'?'ingredients':kind==='gachas'?'rewards':null;
  const rows=child?draft[child]:[];
  const total=rows.reduce((sum,r)=>sum+(Number(r.weight)||0),0);
  function change(k,v){setDraft(d=>({...d,[k]:v}));}
  function changeRow(index,k,v){change(child,rows.map((r,i)=>i===index?{...r,[k]:v}:r));}
  async function save(event) {
    event.preventDefault();if(saving.current)return;
    const error=validateDraft(kind,draft);if(error){setMessage(error);return;}
    saving.current=true;setBusy(true);onBusy(true);setMessage('');
    const body={...draft};
    if(record&&kind==='foods')delete body.item_id;
    if(child)body[child]=rows.map(r=>({item_id:r.item_id,quantity:r.quantity,...(kind==='gachas'?{weight:r.weight}:{})}));
    try {
      const data=await api(`/admin/${kind}${record?`/${record.id}`:''}`,{method:record?'PATCH':'POST',body:{...body,requestKey:crypto.randomUUID()}});
      await onSaved(data.record);
    } catch(e){setMessage(`${e.code||'SAVE_FAILED'}: ${e.message}`);if([401,403].includes(e.status))onDenied(e.message);}
    finally{saving.current=false;setBusy(false);onBusy(false);}
  }
  return <form onSubmit={save} className="admin-form"><h3>{record?`ID ${record.id} 상세/수정`:'새로 등록'}</h3>
    {kind==='recipes'&&<p>성공 4개 / 실패 1개. 실패 시 각 재료 floor(수량/2) 소모.</p>}
    {Object.entries(defaults[kind]).filter(([k])=>k!==child).map(([k,v])=>k.endsWith('item_id')?<ItemPicker key={k} label={labels[k]} value={draft[k]} disabled={busy||(k==='item_id'&&!!record)} onDenied={onDenied} onChange={id=>change(k,id)}/>:<label key={k}>{labels[k]}
      {typeof v==='boolean'?<input type="checkbox" checked={draft[k]} disabled={busy} onChange={e=>change(k,e.target.checked)}/>:
      k==='stat_growth_target'?<select value={draft[k]??''} disabled={busy} onChange={e=>change(k,e.target.value||null)}><option value="">NULL</option>{['ATK','DEF','AGI'].map(s=><option key={s}>{s}</option>)}</select>:
      ['description','rp_effect_text'].includes(k)?<textarea disabled={busy} value={draft[k]??''} onChange={e=>change(k,e.target.value||null)}/>:
      <input type={numeric.includes(k)?'number':'text'} step={k.endsWith('rate')?'any':1} value={draft[k]??''} disabled={busy||(k==='item_id'&&!!record)}
        onChange={e=>change(k,numeric.includes(k)?(e.target.value===''?'':Number(e.target.value)):(e.target.value|| (v===null?null:'')))}/>}
    </label>)}
    {child&&<fieldset className="admin-wide" disabled={busy}><legend>{kind==='recipes'?'재료':'보상'}</legend>
      {rows.map((row,index)=><div className="admin-child-row" key={index}>
        <ItemPicker label={kind==='recipes'?'재료':'보상'} value={row.item_id} disabled={busy} onDenied={onDenied} onChange={id=>changeRow(index,'item_id',id)}/>
        <label>수량<input type="number" min="1" value={row.quantity} onChange={e=>changeRow(index,'quantity',e.target.value===''?'':Number(e.target.value))}/></label>
        {kind==='gachas'&&<><label>가중치<input type="number" min="1" value={row.weight} onChange={e=>changeRow(index,'weight',e.target.value===''?'':Number(e.target.value))}/></label><span>확률 {total>0?(Number(row.weight)/total*100).toFixed(4):'0'}%</span></>}
        <button type="button" onClick={()=>change(child,rows.filter((_,i)=>i!==index))}>행 제거</button>
      </div>)}
      <button type="button" onClick={()=>change(child,[...rows,{item_id:'',quantity:1,...(kind==='gachas'?{weight:1}:{})}])}>행 추가</button>
    </fieldset>}
    <button disabled={busy}>{busy?'저장 중…':'저장'}</button><p role="alert">{message}</p>
  </form>;
}
export default function MasterPanel({kind,onDenied}) {
  const [records,setRecords]=useState([]),[selected,setSelected]=useState(null),[revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[next,setNext]=useState(null);
  async function load(after=null) {
    setBusy(true);
    try{const data=await api(`/admin/${kind}${after?`?after=${after}`:''}`);setRecords(data.records);setNext(data.nextAfter);return true;}
    catch(e){setMessage(`${e.code}: ${e.message}`);if([401,403].includes(e.status))onDenied(e.message);return false;}
    finally{setBusy(false);}
  }
  useEffect(()=>{load(); // Remounted for each menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  async function select(row) {
    setBusy(true);setMessage('');
    try{const data=await api(`/admin/${kind}/${row.id}`);setSelected(data.record);setRevision(v=>v+1);}
    catch(e){setMessage(`${e.code}: ${e.message}`);if([401,403].includes(e.status))onDenied(e.message);}
    finally{setBusy(false);}
  }
  return <section aria-label="마스터 관리"><p role="status">{busy?'불러오는 중…':message}</p>
    <button disabled={busy||saving} onClick={()=>{setSelected(null);setRevision(v=>v+1);setMessage('');}}>새로 등록</button>
    <button disabled={busy||saving} onClick={()=>load()}>목록 새로고침</button>
    {!records.length&&!busy&&<p>등록된 데이터가 없습니다.</p>}
    <ul>{records.map(r=><li key={r.id}>ID {r.id} · {r.name||`음식 아이템 ${r.item_id}`} <button disabled={busy||saving} onClick={()=>select(r)}>상세/수정</button></li>)}</ul>
    {next&&<button disabled={busy||saving} onClick={()=>load(next)}>다음 100건</button>}
    {!busy&&<MasterEditor key={revision} kind={kind} record={selected} onDenied={onDenied} onBusy={setSaving} onSaved={async r=>{
      setSelected(r);setRevision(v=>v+1);if(await load())setMessage('저장 성공');
    }}/>}
  </section>;
}
