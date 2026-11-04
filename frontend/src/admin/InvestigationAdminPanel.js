import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';
import ItemPicker from './ItemPicker';
const empty=()=>({result_grade:'NORMAL',result_text:'',weight:1,is_unique:false,investigation_rate_value:0,clue_id:null,is_active:true,rewards:[]});
const clean=r=>({...Object.fromEntries(Object.keys(empty()).map(k=>[k,r[k]])),weight:Number(r.weight),investigation_rate_value:Number(r.investigation_rate_value),clue_id:r.clue_id==null?null:String(r.clue_id),rewards:r.rewards.map(w=>({item_id:w.item_id==null?null:String(w.item_id),recipe_id:w.recipe_id==null?null:String(w.recipe_id),quantity:w.quantity,probability:Number(w.probability)}))});
export default function InvestigationAdminPanel({onDenied}) {
  const [areas,setAreas]=useState([]),[areaId,setAreaId]=useState(''),[results,setResults]=useState([]),[clues,setClues]=useState([]),[recipes,setRecipes]=useState([]);
  const [id,setId]=useState(null),[draft,setDraft]=useState(empty),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);const pending=useRef(false);
  async function work(fn){if(pending.current)return;pending.current=true;setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(`${e.code||'ERROR'}: ${e.message}`);if([401,403].includes(e.status))onDenied(e.message);}finally{pending.current=false;setBusy(false);}}
  async function initial(){
    async function all(kind){let after=null,rows=[];do{const r=await api(`/admin/${kind}${after?`?after=${after}`:''}`);rows=rows.concat(r.records);after=r.nextAfter;}while(after);return rows;}
    const [a,r]=await Promise.all([all('areas'),all('recipes')]);setAreas(a);setRecipes(r);
  }
  useEffect(()=>{work(initial);},[]); // eslint-disable-line react-hooks/exhaustive-deps
  async function load(value=areaId){const r=await api(`/admin/areas/${value}/results`);setResults(r.results);setClues(r.clues);}
  const change=(key,value)=>setDraft(d=>({...d,[key]:value}));
  const reward=(index,patch)=>change('rewards',draft.rewards.map((r,i)=>i===index?{...r,...patch}:r));
  return <section><h2>조사 결과·보상 관리</h2><p>결과 가중치는 활성 결과 합계 대비 비율입니다. 보상별 확률은 독립 판정하며 합계 100% 제한이 없습니다. 최초 발견 이력은 취소하지 않습니다.</p><p role="alert">{message}</p>
    <label>지역<select value={areaId} disabled={busy} onChange={e=>{const v=e.target.value;setAreaId(v);setId(null);setDraft(empty());setResults([]);setClues([]);if(v)work(()=>load(v));}}><option value="">지역 선택</option>{areas.map(a=><option key={a.id} value={a.id}>{a.name} · ID {a.id}</option>)}</select></label>
    {areaId&&<><button disabled={busy} onClick={()=>work(()=>load())}>결과 새로고침</button><button disabled={busy} onClick={()=>{setId(null);setDraft(empty());}}>새 결과</button>
      <ul>{results.map(r=><li key={r.id}>ID {r.id} · {r.result_text} · 가중치 {r.weight} · {r.is_active?'활성':'비활성'}
        {r.discovery&&<span> · 최초 발견 캐릭터 {r.discovery.character_id} / {r.discovery.discovered_at}</span>}
        <button disabled={busy} onClick={()=>{setId(r.id);setDraft(clean(r));}}>결과 수정</button></li>)}</ul>
      <form className="admin-form" onSubmit={e=>{e.preventDefault();work(async()=>{const r=await api(`/admin/areas/${areaId}/results${id?`/${id}`:''}`,{method:id?'PATCH':'POST',body:{...draft,requestKey:crypto.randomUUID()}});setId(r.record.id);setDraft(clean(r.record));await load();setMessage('조사 설정 저장 성공');});}}>
        <h3>{id?`결과 ${id} 수정`:'신규 결과'}</h3>
        <label>결과 등급<input required maxLength={30} value={draft.result_grade} disabled={busy} onChange={e=>change('result_grade',e.target.value)}/></label>
        <label>결과 내용<textarea required value={draft.result_text} disabled={busy} onChange={e=>change('result_text',e.target.value)}/></label>
        {['weight','investigation_rate_value'].map(k=><label key={k}>{k==='weight'?'선택 가중치':'최초 발견 조사율 상승값'}<input required type="number" min={k==='weight'?1:0} max={k==='weight'?2147483647:100} step={k==='weight'?1:.01} value={draft[k]} disabled={busy} onChange={e=>change(k,e.target.value===''?'':Number(e.target.value))}/></label>)}
        {['is_active','is_unique'].map(k=><label key={k}>{k==='is_active'?'활성':'서버 전체 고유 결과'}<input type="checkbox" checked={draft[k]} disabled={busy} onChange={e=>change(k,e.target.checked)}/></label>)}
        <label>연결 단서<select value={draft.clue_id??''} disabled={busy} onChange={e=>change('clue_id',e.target.value||null)}><option value="">없음</option>{clues.map(c=><option key={c.id} value={c.id}>{c.title} · ID {c.id} · {c.is_discovered?'공개':'미발견'}</option>)}</select></label>
        {draft.rewards.map((r,i)=><fieldset key={i} disabled={busy}><legend>보상 {i+1}</legend>
          <label>종류<select value={r.recipe_id!==null?'recipe':'item'} onChange={e=>reward(i,e.target.value==='recipe'?{recipe_id:'',item_id:null,quantity:1}:{recipe_id:null,item_id:''})}><option value="item">아이템</option><option value="recipe">레시피 최초 발견</option></select></label>
          {r.recipe_id!==null?<label>레시피<select required value={r.recipe_id} onChange={e=>reward(i,{recipe_id:e.target.value})}><option value="">선택</option>{recipes.map(p=><option key={p.id} value={p.id}>{p.name} · ID {p.id}</option>)}</select></label>:<ItemPicker value={r.item_id} onDenied={onDenied} disabled={busy} onChange={value=>reward(i,{item_id:value})}/>}
          <label>수량<input required type="number" min="1" step="1" disabled={r.recipe_id!==null} value={r.quantity} onChange={e=>reward(i,{quantity:Number(e.target.value)})}/></label>
          <label>지급 확률 (%)<input required type="number" min="0" max="100" step=".01" value={r.probability} onChange={e=>reward(i,{probability:Number(e.target.value)})}/></label>
          <button type="button" onClick={()=>change('rewards',draft.rewards.filter((_,n)=>n!==i))}>보상 제거</button>
        </fieldset>)}
        <button type="button" disabled={busy} onClick={()=>change('rewards',[...draft.rewards,{item_id:'',recipe_id:null,quantity:1,probability:100}])}>보상 추가</button><button disabled={busy}>조사 설정 저장</button>
      </form>
    </>}
  </section>;
}
