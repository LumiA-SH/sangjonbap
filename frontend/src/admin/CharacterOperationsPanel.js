import CharacterDetailsEditor from './CharacterDetailsEditor';
import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';
import ItemPicker from './ItemPicker';

const fields={hp:'HP',blood:'혈량',ap:'AP',currency:'재화',atk:'ATK',def:'DEF',agi:'AGI'};
export default function CharacterOperationsPanel({onDenied,recordId,onOpen}) {
  const [query,setQuery]=useState(''),[rows,setRows]=useState([]),[next,setNext]=useState(null),[data,setData]=useState(null),[draft,setDraft]=useState({});
  const [itemId,setItemId]=useState(''),[quantity,setQuantity]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const pending=useRef(false);
  async function work(fn){if(pending.current)return;pending.current=true;setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(`${e.code||'ERROR'}: ${e.message}`);if([401,403].includes(e.status))onDenied(e.message);}finally{pending.current=false;setBusy(false);}}
  async function search(after=null){const r=await api(`/admin/characters?q=${encodeURIComponent(query)}${after?`&after=${after}`:''}`);setRows(r.records);setNext(r.nextAfter);}
  async function select(id){const r=await api(`/admin/characters/${id}`);setData(r);setDraft(Object.fromEntries(Object.keys(fields).map(k=>[k,Number(r.character[k])])));}
  useEffect(()=>{if(!onOpen)return;let live=true;setData(null);if(recordId&&recordId!=='new'){setBusy(true);api('/admin/characters/'+recordId).then(r=>{if(live){setData(r);setDraft(Object.fromEntries(Object.keys(fields).map(k=>[k,Number(r.character[k])])));}}).catch(e=>{if(live){setMessage(e.message);if([401,403].includes(e.status))onDenied(e.message);}}).finally(()=>{if(live)setBusy(false);});}return()=>{live=false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[recordId]);
  async function save(inventory){
    if(!window.confirm(`${data.character.name} (ID ${data.character.id})의 ${inventory?'아이템 보유량':'자원·능력치'}을 수정합니까?`))return;
    await api(`/admin/characters/${data.character.id}${inventory?'/inventory':''}`,{method:'PATCH',body:{...(inventory?{itemId,quantity}:draft),requestKey:crypto.randomUUID()}});await select(data.character.id);setMessage('저장 성공');
  }
  return <section><h2>캐릭터 운영 관리</h2><p>상태는 HP·혈량 변경에 따라 공용 규칙으로 결정합니다. 사망 강제 복구·최초 발견 이력 취소는 지원하지 않으며, ACTIVE 전투 중에는 수정할 수 없습니다.</p>
    <form onSubmit={e=>{e.preventDefault();work(()=>search());}}><label>캐릭터 이름<input value={query} maxLength={100} disabled={busy} onChange={e=>setQuery(e.target.value)}/></label><button disabled={busy}>캐릭터 검색</button></form>
    <p role="alert">{message}</p><ul>{rows.map(r=><li key={r.id}>{r.name} · ID {r.id} · {r.status} · {r.is_active?'활성':'비활성'}<button disabled={busy} onClick={()=>onOpen?onOpen(String(r.id)):work(()=>select(r.id))}>선택</button></li>)}</ul>
    {next&&<button disabled={busy} onClick={()=>work(()=>search(next))}>다음 50건</button>}
    {data&&<><h3>{data.character.name} · {data.character.status}</h3><p>사망 {data.character.death_count}회 · 부활 {data.character.revive_count}회</p>
      <form className="admin-form" onSubmit={e=>{e.preventDefault();work(()=>save(false));}}>{Object.entries(fields).map(([k,label])=><label key={k}>{label}<input required type="number" min="0" step="1" value={draft[k]} disabled={busy} onChange={e=>setDraft({...draft,[k]:e.target.value===''?'':Number(e.target.value)})}/></label>)}<button disabled={busy}>캐릭터 저장</button></form>
      <CharacterDetailsEditor key={data.character.id} id={data.character.id} onDenied={onDenied} onSaved={()=>select(data.character.id)}/>
      <h3>보유 아이템</h3><ul>{data.inventory.map(r=><li key={r.item_id}>{r.name} · ID {r.item_id} · {r.quantity}개<button disabled={busy} onClick={()=>{setItemId(String(r.item_id));setQuantity(r.quantity);}}>수량 선택</button></li>)}</ul>
      <form className="admin-form" onSubmit={e=>{e.preventDefault();work(()=>save(true));}}><ItemPicker value={itemId} onChange={setItemId} disabled={busy} onDenied={onDenied}/><label>최종 보유 수량<input required type="number" min="0" step="1" value={quantity} disabled={busy} onChange={e=>setQuantity(e.target.value===''?'':Number(e.target.value))}/></label><button disabled={busy||!itemId}>보유량 저장</button></form>
    </>}
  </section>;
}
