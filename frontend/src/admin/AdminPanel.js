import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import MasterPanel from './MasterPanel';
import RolePanel from './RolePanel';
import BattleAdminPanel from './BattleAdminPanel';
import ItemPicker from './ItemPicker';

const emptyItem={name:'',category:'ETC',description:null,transferable:true,is_active:true,effect_type:null,effect_value:null,usable:false,use_target:'NONE',battle_usable:false};
const emptyProduct={item_id:'',price:0,purchase_limit:null,stock_limit:null,daily_limit:null,is_active:true,sort_order:0};
function Editor({kind,record,seed,onSaved,onDenied}) {
  const fields=kind==='items'?emptyItem:emptyProduct;
  const [draft,setDraft]=useState(()=>Object.fromEntries(Object.keys(fields).map(key=>[key,record?.[key] ?? seed?.[key] ?? fields[key]])));
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const saving=useRef(false);
  function change(key,value){setDraft({...draft,[key]:value});}
  async function submit(event) {
    event.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setMessage('');
    try {
      const {record:saved}=await api(`/admin/${kind}${record?`/${record.id}`:''}`,{method:record?'PATCH':'POST',body:{...draft,requestKey:crypto.randomUUID()}});
      setMessage('저장 성공');onSaved(saved);
    } catch(e){setMessage(`${e.code || 'SAVE_FAILED'}: ${e.message}`);if(e.status===401||e.status===403)onDenied(e.message);}
    finally{saving.current=false;setBusy(false);}
  }
  return <form className="admin-form" onSubmit={submit}>
    <h3>{record?`ID ${record.id} 수정`:'새로 등록'}</h3>
    {Object.keys(fields).map(key=>key==='item_id'?<ItemPicker key={key} label="판매 아이템" value={draft.item_id} disabled={busy} onDenied={onDenied} onChange={(id,item)=>setDraft(d=>({...d,item_id:id,...(item?.effect_type==='BLOOD_PACK'?{price:0,daily_limit:1}:{})}))}/>:<label key={key}>{({name:'이름',category:'종류',description:'설명',transferable:'이동 가능',is_active:'활성',item_id:'판매 아이템 ID',price:'가격',purchase_limit:'개인 누적 한도',stock_limit:'전체 누적 재고 한도',sort_order:'표시 순서',daily_limit:'일일 구매 한도',effect_type:'효과',battle_usable:'전투 사용 가능',effect_value:'효과 수치',usable:'사용 가능',use_target:'사용 대상'})[key]}
      {typeof fields[key]==='boolean'?<input type="checkbox" checked={draft[key]} disabled={busy} onChange={e=>change(key,e.target.checked)}/>:
        key==='effect_type'?<select value={draft[key]??''} disabled={busy} onChange={e=>setDraft({...draft,effect_type:e.target.value||null,effect_value:e.target.value?10:null,usable:!!e.target.value,use_target:e.target.value?'SELF':'NONE',transferable:true})}><option value="">없음</option><option value="BLOOD_PACK">혈액팩</option></select>:
        key==='effect_value'?<input type="number" min="1" value={draft[key]??''} disabled={busy} onChange={e=>change(key,e.target.value===''?null:Number(e.target.value))}/>:key==='use_target'?<input value={draft[key]??''} readOnly/>:
        key==='category'?<select value={draft[key]} disabled={busy} onChange={e=>change(key,e.target.value)}>{['MATERIAL','CONSUMABLE','FOOD','ETC'].map(v=><option key={v}>{v}</option>)}</select>:
        key==='description'?<textarea value={draft[key]??''} disabled={busy} onChange={e=>change(key,e.target.value||null)}/>:
        ['purchase_limit','stock_limit','daily_limit'].includes(key)?<><span><input type="checkbox" checked={draft[key]===null} disabled={busy} onChange={e=>change(key,e.target.checked?null:['purchase_limit','daily_limit'].includes(key)?1:0)}/>무제한(NULL)</span>
          <input type="number" min={key==='purchase_limit'?1:0} max={2147483647} value={draft[key]??''} disabled={busy||draft[key]===null} required={draft[key]!==null} onChange={e=>change(key,e.target.value===''?'':Number(e.target.value))}/></>:
        <input type={['price','sort_order'].includes(key)?'number':'text'} value={draft[key]} required disabled={busy}
          maxLength={key==='name'?100:undefined} onChange={e=>change(key,['price','sort_order'].includes(key)?(e.target.value===''?'':Number(e.target.value)):e.target.value)}/>}
    </label>)}
    <button disabled={busy}>{busy?'저장 중…':'저장'}</button><p role="status">{message}</p>
  </form>;
}
export default function AdminPanel({onBack}) {
  const [authentication,setAuthentication]=useState('');
  const [allowed,setAllowed]=useState(false),[kind,setKind]=useState('items'),[rows,setRows]=useState([]);
  const [selected,setSelected]=useState(null),[editorKey,setEditorKey]=useState(0),[message,setMessage]=useState('권한 확인 중…');
  const [busy,setBusy]=useState(false),[next,setNext]=useState(null);
  const [productSeed,setProductSeed]=useState(null);
  function denied(message){setAllowed(false);setRows([]);setSelected(null);setMessage(message);}
  async function load(type=kind,after=null) {
    setBusy(true);setMessage('');
    try {const data=await api(`/admin/${type}${after?`?after=${after}`:''}`);setRows(data.records);setNext(data.nextAfter);return true;}
    catch(e){setMessage(`${e.code || 'LOAD_FAILED'}: ${e.message}`);if(e.status===401||e.status===403)denied(e.message);}
    finally{setBusy(false);}
  }
  useEffect(()=>{
    let live=true;
    api('/admin/access').then(data=>{if(live){setAuthentication(data.authentication||'DEV');setAllowed(true);load('items');}}).catch(e=>{if(live)denied(`${e.code || 'ACCESS_FAILED'}: ${e.message}`);});
    return()=>{live=false;};
    // Access is checked again by the server on every request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  async function select(row){
    setBusy(true);
    try{const data=await api(`/admin/${kind}/${row.id}`);setSelected(data.record);setEditorKey(v=>v+1);}
    catch(e){setMessage(e.message);if(e.status===401||e.status===403)denied(e.message);}
    finally{setBusy(false);}
  }
  return <section className="admin-panel"><h1>관리자</h1>
    <p>서버 ADMIN 권한 검증 영역입니다. 인증 방식: {authentication||'확인 중'}</p>
    <button onClick={onBack}>DEV 콘솔로 돌아가기</button><p role="alert">{message}</p>
    {allowed&&<>
      <nav className="actions">{[['items','아이템'],['products','상점 상품'],['foods','음식 설정'],['recipes','레시피'],['gachas','가챠'],['users','관리자 권한'],['battle','PVE·캐릭터 등록']].map(([type,label])=><button key={type} disabled={busy} onClick={()=>{setKind(type);setSelected(null);setEditorKey(v=>v+1);if(['items','products'].includes(type))load(type);}}>{label}</button>)}</nav>
      {kind==='battle'?<BattleAdminPanel onDenied={denied}/>:kind==='users'?<RolePanel onDenied={denied}/>:['foods','recipes','gachas'].includes(kind)?<MasterPanel key={kind} kind={kind} onDenied={denied}/>:<>
      <p>혈액팩은 명시적 효과로 지정하며 무료 상품의 일일 한도는 1입니다. 다른 효과·이미지 URL 편집은 HOLD입니다. 삭제 기능은 제공하지 않습니다.</p>
      {kind==='items'&&selected&&<button disabled={busy} onClick={()=>{
        setProductSeed({item_id:String(selected.id),price:0,daily_limit:selected.effect_type==='BLOOD_PACK'?1:null});
        setKind('products');setSelected(null);setEditorKey(v=>v+1);load('products');
      }}>이 아이템을 상점에 등록</button>}
      {kind==='products'&&<p>저장 후 DEV 콘솔로 돌아가 상점 목록을 새로고침하고 구매를 검증하세요. 구매는 로그인한 캐릭터의 실제 재화를 사용합니다.</p>}
      <button disabled={busy} onClick={()=>{setSelected(null);setEditorKey(v=>v+1);}}>새로 등록</button>
      <button disabled={busy} onClick={()=>load()}>목록 새로고침</button>
      <ul>{rows.map(row=><li key={row.id}>ID {row.id} · {row.name || `아이템 ${row.item_id} / 가격 ${row.price}`} · {row.is_active?'활성':'비활성'} <button disabled={busy} onClick={()=>select(row)}>상세/수정</button></li>)}</ul>
      {next&&<button disabled={busy} onClick={()=>load(kind,next)}>다음 100건</button>}
      <Editor key={`${kind}-${editorKey}`} kind={kind} record={selected} seed={kind==='products'?productSeed:null} onDenied={denied} onSaved={saved=>{setProductSeed(null);setSelected(saved);setEditorKey(v=>v+1);load().then(ok=>{if(ok)setMessage('저장 성공');});}}/>
      </>}
    </>}
  </section>;
}
