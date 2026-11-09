import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';
const toLocal=value=>{if(!value)return '';const d=new Date(new Date(value).getTime()+9*3600000);return d.toISOString().slice(0,16);};
const toIso=value=>value?value+':00+09:00':null;
export default function ContentAdminPanel({kind,onDenied}){
 const [loaded,setLoaded]=useState(null),[draft,setDraft]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);const pending=useRef(false);
 async function work(f){if(pending.current)return;pending.current=true;setBusy(true);setMessage('');try{await f();}catch(e){setMessage(`${e.code||'ERROR'}: ${e.message}`);if([401,403].includes(e.status))onDenied?.(e.message);}finally{pending.current=false;setBusy(false);}}
 async function load(){const r=await api('/admin/content/'+kind);setLoaded(r);setDraft(r.content);}
 useEffect(()=>{work(load);},[]); // eslint-disable-line react-hooks/exhaustive-deps
 const update=(index,key,value)=>setDraft(old=>index===null?{...old,[key]:value}:{...old,items:old.items.map((r,i)=>i===index?{...r,[key]:value}:r)});
 const editor=(row,index)=><fieldset disabled={busy}><legend>{index===null?'전체 안내':`항목 ${index+1}`}</legend>
 <label>제목<input maxLength={100} required={row.published} value={row.title} onChange={e=>update(index,'title',e.target.value)}/></label>
 <label>내용<textarea maxLength={3000} value={row.body} onChange={e=>update(index,'body',e.target.value)}/></label>
 <label>공개<input type="checkbox" checked={row.published} onChange={e=>update(index,'published',e.target.checked)}/></label>
 {index!==null&&<label>표시 순서<input type="number" min="0" max="2147483647" step="1" required value={row.order} onChange={e=>update(index,'order',e.target.value===''?'':Number(e.target.value))}/></label>}
 {kind==='schedule'&&<>{['startAt','endAt'].map(key=><label key={key}>{key==='startAt'?'시작':'종료'} (KST)<input type="datetime-local" min="2000-01-01T00:00" max="9999-12-31T23:59" required={row.published} value={toLocal(row[key])} onChange={e=>update(index,key,toIso(e.target.value))}/></label>)}</>}
 {index!==null&&<button type="button" onClick={()=>setDraft(old=>({...old,items:old.items.filter((_,i)=>i!==index)}))}>항목 제거</button>}</fieldset>;
 return <section><h2>{{world:'세계관 관리',system:'시스템 안내 관리',schedule:'러닝 일정 관리'}[kind]}</h2><button disabled={busy} onClick={()=>work(load)}>저장된 내용 다시 조회</button>
 <p>본문은 일반 텍스트로 표시합니다. 미등록 내용은 작성하지 않았으며, 비공개 항목은 방문자에게 전달하지 않습니다. 전체 내용은 UTF-8 12KB, 항목은 최대 20개입니다.</p>
 {kind==='schedule'&&<p>공식 v0.2의 일정을 확인하여 입력하세요. 시작 시각 포함·종료 시각 제외로 표시합니다. 마지막 날 전체를 포함하려면 다음 날 00:00을 종료로 입력하세요. 일정 콘텐츠는 게임 시작일·자정 초기화·Maintenance와 별개입니다.</p>}
 {draft&&<form onSubmit={e=>{e.preventDefault();work(async()=>{if(!window.confirm('변경 전후와 공개 범위를 확인하고 안내를 저장합니까?'))return;const r=await api('/admin/content/'+kind,{method:'PATCH',body:{content:draft,expectedVersion:loaded.version,requestKey:crypto.randomUUID()}});setLoaded(r);setDraft(r.content);setMessage('저장 성공');});}}>
 {kind!=='system'&&editor(draft,null)}{draft.items?.map((row,i)=><div key={row.id}>{editor(row,i)}</div>)}
 {kind!=='world'&&<button type="button" disabled={busy||draft.items.length>=20} onClick={()=>setDraft(old=>({...old,items:[...old.items,{id:crypto.randomUUID(),title:'',body:'',published:false,order:old.items.length,...(kind==='schedule'?{startAt:null,endAt:null}:{})}]}))}>안내 항목 추가</button>}
 <details><summary>변경 전후 비교</summary><pre>{JSON.stringify({before:loaded.content,after:draft},null,2)}</pre></details><button disabled={busy}>안내 저장</button></form>}
 <p role="status">{busy?'처리 중…':message}</p></section>;
}
