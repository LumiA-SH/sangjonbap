import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';
import ItemPicker from './ItemPicker';

const empty=()=>({is_failure:false,failure_selectable:true,result_grade:'NORMAL',result_text:'',weight:1,is_unique:false,clue_id:null,is_active:true,rewards:[]});

const clean=r=>({
  ...Object.fromEntries(Object.keys(empty()).map(k=>[k,r[k]??empty()[k]])),
  weight:Number(r.weight),
  clue_id:r.clue_id==null?null:String(r.clue_id),
  rewards:(r.rewards||[]).filter(w=>w.item_id!=null).map(w=>({
    item_id:String(w.item_id),quantity:Number(w.quantity),probability:Number(w.probability)
  }))
});

const cleanAreaRecipes=rows=>(rows||[]).map(row=>({
  recipe_id:String(row.recipe_id),weight:Number(row.weight),drop_rate:Number(row.drop_rate),
  discovered:!!row.discovered,recipe_name:row.recipe_name
}));

export default function InvestigationAdminPanel({onDenied,route,onNavigate}) {
  const [areas,setAreas]=useState([]),[areaId,setAreaId]=useState('');
  const [results,setResults]=useState([]),[clues,setClues]=useState([]),[recipes,setRecipes]=useState([]);
  const [areaRecipes,setAreaRecipes]=useState([]);
  const [id,setId]=useState(null),[draft,setDraft]=useState(empty);
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const pending=useRef(false);

  async function work(fn) {
    if (pending.current) return;
    pending.current=true;
    setBusy(true);
    setMessage('');

    try {
      await fn();
    } catch(e) {
      setMessage(`${e.code||'ERROR'}: ${e.message}`);
      if ([401,403].includes(e.status)) onDenied(e.message);
    } finally {
      pending.current=false;
      setBusy(false);
    }
  }

  async function initial() {
    async function all(kind) {
      let after=null,rows=[];
      do {
        const r=await api(`/admin/${kind}${after?`?after=${after}`:''}`);
        rows=rows.concat(r.records);
        after=r.nextAfter;
      } while(after);
      return rows;
    }

    const [a,r]=await Promise.all([all('areas'),all('recipes')]);
    setAreas(a);
    setRecipes(r);
  }

  useEffect(()=>{
    work(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  function applyAreaData(data) {
    setResults(data.results);
    setClues(data.clues);
    setAreaRecipes(cleanAreaRecipes(data.areaRecipes));
  }

  async function load(value=areaId) {
    const data=await api(`/admin/areas/${value}/results`);
    applyAreaData(data);
  }

  useEffect(()=>{
    if (!onNavigate) return;

    let live=true;
    setAreaId(route.area||'');
    setResults([]);
    setClues([]);
    setAreaRecipes([]);
    setId(null);
    setDraft(empty());

    if (route.area) {
      setBusy(true);
      api('/admin/areas/'+route.area+'/results').then(data=>{
        if (live) applyAreaData(data);
      }).catch(e=>{
        if (live) {
          setMessage(e.message);
          if ([401,403].includes(e.status)) onDenied(e.message);
        }
      }).finally(()=>{
        if (live) setBusy(false);
      });
    }

    return ()=>{live=false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[route?.area]);

  const routed=!!onNavigate;

  useEffect(()=>{
    if (!routed) return;
    const selected=results.find(r=>String(r.id)===String(route.record));
    setId(selected?.id||null);
    setDraft(selected?clean(selected):empty());
  },[route?.record,results,routed]);

  const change=(key,value)=>setDraft(d=>({...d,[key]:value}));
  const reward=(index,patch)=>change('rewards',draft.rewards.map((r,i)=>i===index?{...r,...patch}:r));

  function changeAreaRecipe(index,patch) {
    setAreaRecipes(rows=>rows.map((row,i)=>i===index?{...row,...patch}:row));
  }

  function saveAreaRecipes(event) {
    event.preventDefault();

    const rows=areaRecipes.map(row=>({
      recipe_id:row.recipe_id,weight:row.weight,drop_rate:row.drop_rate
    }));

    work(async()=>{
      const data=await api(`/admin/areas/${areaId}/recipes`,{
        method:'PUT',
        body:{recipes:rows,requestKey:crypto.randomUUID()}
      });

      setAreaRecipes(cleanAreaRecipes(data.recipes));
      setMessage('구역별 레시피 설정 저장 성공');
    });
  }

  function saveInvestigation(event) {
    event.preventDefault();

    work(async()=>{
      const data=await api(`/admin/areas/${areaId}/results${id?`/${id}`:''}`,{
        method:id?'PATCH':'POST',
        body:{...draft,requestKey:crypto.randomUUID()}
      });

      setId(data.record.id);
      setDraft(clean(data.record));
      await load();
      setMessage('조사 설정 저장 성공');
    });
  }

  return <section>
    <h2>조사 결과·보상 관리</h2>
    <p>조사 결과는 가중치에 따라 선택됩니다. 고유 조사결과와 마물·레시피 최초 발견 기록을 기준으로 조사율이 자동 계산됩니다. 아이템 보상 확률은 각각 독립 판정하며, 실패 분류는 AP·보상·조우 규칙에 영향을 주지 않습니다.</p>
    <p role="alert">{message}</p>

    <label>지역
      <select value={areaId} disabled={busy} onChange={e=>{
        const value=e.target.value;
        if (onNavigate) {
          onNavigate({area:value||null,record:null});
          return;
        }

        setAreaId(value);
        setId(null);
        setDraft(empty());
        setResults([]);
        setClues([]);
        setAreaRecipes([]);
        if (value) work(()=>load(value));
      }}>
        <option value="">지역 선택</option>
        {areas.map(a=><option key={a.id} value={a.id}>{a.name} · ID {a.id}</option>)}
      </select>
    </label>

    {areaId&&<>
      <form className="admin-form" onSubmit={saveAreaRecipes}>
        <h3>구역별 레시피 후보 관리</h3>
        <p>해당 구역의 조사 또는 마물 처치 시 미발견 레시피 중 최대 1종을 추첨합니다. 가중치는 후보 간 선택 비율이며, 발견 확률은 선택된 레시피에 적용됩니다.</p>

        {areaRecipes.map((row,index)=><fieldset key={index} disabled={busy}>
          <legend>레시피 후보 {index+1} {row.discovered?'· 최초 발견 완료':''}</legend>

          <label>레시피
            <select required value={row.recipe_id} disabled={busy||row.discovered} onChange={e=>changeAreaRecipe(index,{recipe_id:e.target.value})}>
              <option value="">레시피 선택</option>
              {recipes.map(recipe=><option key={recipe.id} value={recipe.id} disabled={!recipe.is_active&&String(recipe.id)!==row.recipe_id}>
                {recipe.name} · ID {recipe.id}
              </option>)}
            </select>
          </label>

          <label>선택 가중치
            <input required type="number" min="1" max="2147483647" step="1" value={row.weight} disabled={busy} onChange={e=>changeAreaRecipe(index,{weight:e.target.value===''?'':Number(e.target.value)})}/>
          </label>

          <label>발견 확률 (%)
            <input required type="number" min="0" max="100" step=".01" value={row.drop_rate} disabled={busy} onChange={e=>changeAreaRecipe(index,{drop_rate:e.target.value===''?'':Number(e.target.value)})}/>
          </label>

          <button type="button" disabled={busy||row.discovered} onClick={()=>setAreaRecipes(rows=>rows.filter((_,i)=>i!==index))}>후보 제거</button>
        </fieldset>)}

        <button type="button" disabled={busy} onClick={()=>setAreaRecipes(rows=>[...rows,{recipe_id:'',weight:1,drop_rate:100,discovered:false}])}>레시피 후보 추가</button>
        <button disabled={busy}>구역별 레시피 설정 저장</button>
      </form>

      <button disabled={busy} onClick={()=>work(()=>load())}>결과 새로고침</button>
      <button disabled={busy} onClick={()=>{
        setId(null);
        setDraft(empty());
        onNavigate?.({record:'new'});
      }}>새 조사 결과</button>

      <ul>{results.map(r=><li key={r.id}>
        ID {r.id} · {r.result_text} · 가중치 {r.weight} · {r.is_active?'활성':'비활성'}
        {r.discovery&&<span> · 최초 발견 캐릭터 {r.discovery.character_id} / {r.discovery.discovered_at}</span>}
        <button disabled={busy} onClick={()=>{
          if (onNavigate) {
            onNavigate({record:String(r.id)});
            return;
          }
          setId(r.id);
          setDraft(clean(r));
        }}>결과 수정</button>
      </li>)}</ul>

      {(!onNavigate||route.record==='new'||id)&&<form className="admin-form" onSubmit={saveInvestigation}>
        {id&&<details>
          <summary>변경 전후 확인</summary>
          <pre>{JSON.stringify({before:results.find(r=>r.id===id),after:draft},null,2)}</pre>
        </details>}

        <h3>{id?`결과 ${id} 수정`:'신규 결과'}</h3>

        <label>결과 등급
          <input required maxLength={30} value={draft.result_grade} disabled={busy} onChange={e=>change('result_grade',e.target.value)}/>
        </label>

        <label>결과 내용
          <textarea required value={draft.result_text} disabled={busy} onChange={e=>change('result_text',e.target.value)}/>
        </label>

        <label>선택 가중치
          <input required type="number" min="1" max="2147483647" step="1" value={draft.weight} disabled={busy} onChange={e=>change('weight',e.target.value===''?'':Number(e.target.value))}/>
        </label>

        {['is_active','is_unique','is_failure','failure_selectable'].map(k=><label key={k}>
          {{is_active:'활성',is_unique:'서버 전체 고유 결과',is_failure:'실패 결과',failure_selectable:'실패 결과도 선택에 포함'}[k]}
          <input type="checkbox" checked={draft[k]} disabled={busy} onChange={e=>change(k,e.target.checked)}/>
        </label>)}

        <label>연결 단서
          <select value={draft.clue_id??''} disabled={busy} onChange={e=>change('clue_id',e.target.value||null)}>
            <option value="">없음</option>
            {clues.map(c=><option key={c.id} value={c.id}>{c.title} · ID {c.id} · {c.is_discovered?'공개':'미발견'}</option>)}
          </select>
        </label>

        {draft.rewards.map((r,i)=><fieldset key={i} disabled={busy}>
          <legend>아이템 보상 {i+1}</legend>
          <ItemPicker value={r.item_id} onDenied={onDenied} disabled={busy} onChange={value=>reward(i,{item_id:value})}/>

          <label>수량
            <input required type="number" min="1" max="2147483647" step="1" value={r.quantity} onChange={e=>reward(i,{quantity:e.target.value===''?'':Number(e.target.value)})}/>
          </label>

          <label>지급 확률 (%)
            <input required type="number" min="0" max="100" step=".01" value={r.probability} onChange={e=>reward(i,{probability:e.target.value===''?'':Number(e.target.value)})}/>
          </label>

          <button type="button" disabled={busy} onClick={()=>change('rewards',draft.rewards.filter((_,n)=>n!==i))}>보상 제거</button>
        </fieldset>)}

        <button type="button" disabled={busy} onClick={()=>change('rewards',[...draft.rewards,{item_id:'',quantity:1,probability:100}])}>아이템 보상 추가</button>
        <button disabled={busy}>조사 설정 저장</button>
      </form>}
    </>}
  </section>;
}