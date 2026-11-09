import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';
const empty={title:'',content:'',related_target:null,area_id:'',is_public:true};
export default function ClueAdminPanel({onDenied,recordId,onOpen}){
 const [rows,setRows]=useState([]),[next,setNext]=useState(null),[q,setQ]=useState(''),[areas,setAreas]=useState([]),[loaded,setLoaded]=useState(null),[draft,setDraft]=useState(null),[reason,setReason]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);const pending=useRef(false);
 async function work(f){if(pending.current)return;pending.current=true;setBusy(true);setMessage('');try{await f();}catch(e){setMessage(`${e.code||'ERROR'}: ${e.message}`);if([401,403].includes(e.status))onDenied?.(e.message);}finally{pending.current=false;setBusy(false);}}
 async function list(after=null){const r=await api('/admin/clues?q='+encodeURIComponent(q)+(after?'&after='+after:''));setRows(r.records);setNext(r.nextAfter);}
 async function open(id){setReason('');if(id==='new'){setLoaded(null);setDraft({...empty});return;}const r=await api('/admin/clues/'+id);setLoaded(r);setDraft(Object.fromEntries(Object.keys(empty).map(k=>[k,r.record[k]])));}
 useEffect(()=>{let active=true;setBusy(true);setDraft(null);
 (async()=>{try{const [listResult,areaResult,detail]=await Promise.all([api('/admin/clues?q='),api('/admin/battle-areas'),onOpen&&recordId&&recordId!=='new'?api('/admin/clues/'+recordId):Promise.resolve(null)]);
 if(!active)return;setRows(listResult.records);setNext(listResult.nextAfter);setAreas(areaResult.records);setReason('');setLoaded(detail);
 if(recordId==='new')setDraft({...empty});else if(detail)setDraft(Object.fromEntries(Object.keys(empty).map(k=>[k,detail.record[k]])));
 }catch(e){if(active){setMessage(e.message);if([401,403].includes(e.status))onDenied?.(e.message);}}finally{if(active)setBusy(false);}})();return()=>{active=false;};
 },[recordId]); // eslint-disable-line react-hooks/exhaustive-deps
 const choose=id=>onOpen?onOpen(id):work(()=>open(id));
 return <section><h2>단서 등록·수정</h2><p>미발견 단서는 공개 설정과 관계없이 숨깁니다. 발견자·발견 시각·조사율은 이 화면에서 변경하지 않습니다.</p>
 <form onSubmit={e=>{e.preventDefault();work(()=>list());}}><label>단서 검색<input value={q} onChange={e=>setQ(e.target.value)}/></label><button disabled={busy}>검색</button></form>
 <button disabled={busy} onClick={()=>choose('new')}>새 단서</button><ul>{rows.map(r=><li key={r.id}>{r.title} · {r.is_discovered?'발견':'미발견'} · {r.is_public?'공개 허용':'비공개'}<button disabled={busy} onClick={()=>choose(String(r.id))}>단서 상세</button></li>)}</ul>
 {next&&<button disabled={busy} onClick={()=>work(()=>list(next))}>다음 단서</button>}
 {draft&&<form className="admin-form" onSubmit={e=>{e.preventDefault();work(async()=>{if(!window.confirm('발견 기록을 보존하고 단서 내용을 저장합니까?'))return;
 const r=await api('/admin/clues'+(loaded?'/'+loaded.record.id:''),{method:loaded?'PATCH':'POST',body:{...draft,reason,expectedVersion:loaded?.version,requestKey:crypto.randomUUID()}});setLoaded(r);setDraft(Object.fromEntries(Object.keys(empty).map(k=>[k,r.record[k]])));await list();setMessage('저장 성공');});}}>
 <label>제목<input required maxLength={100} disabled={busy} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
 <label>내용<textarea maxLength={10000} disabled={busy} value={draft.content} onChange={e=>setDraft({...draft,content:e.target.value})}/></label>
 <label>관련 대상<input maxLength={200} disabled={busy} value={draft.related_target||''} onChange={e=>setDraft({...draft,related_target:e.target.value||null})}/></label>
 <label>관련 구역<select required disabled={busy} value={draft.area_id||''} onChange={e=>setDraft({...draft,area_id:e.target.value})}><option value="">선택</option>{areas.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
 <label>발견 후 공개 허용<input type="checkbox" disabled={busy} checked={draft.is_public} onChange={e=>setDraft({...draft,is_public:e.target.checked})}/></label>
 {loaded&&<p>발견 여부: {loaded.record.is_discovered?'발견':'미발견'} · 최초 발견자 ID {loaded.record.first_discoverer_id||'-'} · {loaded.record.discovered_at||'-'}</p>}
 <label>수정 사유<input required maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <details className="admin-wide"><summary>변경 전후 비교</summary><pre>{JSON.stringify({before:loaded?.record||null,after:draft},null,2)}</pre></details><button disabled={busy}>단서 저장</button></form>}
 <p role="status">{busy?'처리 중…':message}</p></section>;
}
