import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';

export default function StorageAdminPanel({onDenied}) {
 const [rows, setRows] = useState([]);
 const [q, setQ] = useState('');
 const [next, setNext] = useState(null);
 const [selected, setSelected] = useState(null);
 const [quantity, setQuantity] = useState(0);
 const [reason, setReason] = useState('');
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState('');
 const pending = useRef(false);

 async function work(f) {
  if (pending.current) return;

  pending.current = true;
  setBusy(true);
  setMessage('');

  try {
   await f();
  } catch (e) {
   setMessage(`${e.code || 'ERROR'}: ${e.message}`);
   if ([401, 403].includes(e.status)) onDenied?.(e.message);
  } finally {
   pending.current = false;
   setBusy(false);
  }
 }

 async function load(after = null) {
  const r = await api('/admin/storage?q=' + encodeURIComponent(q) + (after ? '&after=' + after : ''));
  setRows(r.records);
  setNext(r.nextAfter);
 }

 useEffect(() => {
  work(() => load());
 }, []); // eslint-disable-line react-hooks/exhaustive-deps

 function selectItem(row) {
  setSelected(row);
  setQuantity(row.quantity);
  setReason('');
 }

 async function save(e) {
  e.preventDefault();
  if(!selected)return;

  await work(async () => {
   if (!window.confirm(`${selected.name}: ${selected.quantity} → ${quantity}개로 변경합니까?`)) return;

   await api('/admin/storage/' + selected.item_id, {
    method: 'PATCH',
    body: {
     quantity,
     expectedQuantity: selected.quantity,
     reason,
     requestKey: crypto.randomUUID()
    }
   });

   setSelected(null);
   await load();
   setMessage('저장 성공');
  });
 }

 return <section className="admin-operations-page admin-storage-inline">
  <form className="admin-log-search" onSubmit={e=>{e.preventDefault();work(()=>load());}}>
   <label>아이템 검색<input value={q} disabled={busy} onChange={e=>setQ(e.target.value)}/></label><button disabled={busy}>검색</button>
  </form>
  <form className="admin-storage-form" onSubmit={save}>
   <div className="admin-balance-table-wrap"><table className="admin-balance-table"><thead><tr><th>아이템</th><th>현재 수량</th><th>변경 수량</th></tr></thead><tbody>
    {rows.map(row=><tr key={row.item_id}><td><strong>{row.name}</strong><small> ID {row.item_id}</small></td><td>{row.quantity}</td><td><input aria-label={row.name+' 변경 수량'} type="number" min="0" max="2147483647" step="1" disabled={busy} value={selected?.item_id===row.item_id?quantity:row.quantity} onChange={e=>{if(selected?.item_id!==row.item_id)selectItem(row);setQuantity(e.target.value===''?'':Number(e.target.value));}}/></td></tr>)}
    {!rows.length&&<tr><td colSpan="3">등록된 재고가 없습니다.</td></tr>}
   </tbody></table></div>
   {selected&&<section className="admin-editor-section"><p>{selected.name}: 변경 전 {selected.quantity} → 변경 후 {quantity}개</p><label>수정 사유<input required maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
    <footer className="admin-editor-footer"><button disabled={busy||!Number.isInteger(quantity)||quantity<0||quantity>2147483647||!reason.trim()}>재고 저장</button><button type="button" disabled={busy} onClick={()=>setSelected(null)}>취소</button></footer>
   </section>}
  </form>
  {next&&<button disabled={busy} onClick={()=>work(()=>load(next))}>다음 100건</button>}
  <p>수량 변경은 한 항목씩 저장합니다. 조회 이후 입출고가 발생하면 다시 조회해 주세요.</p><p role="status">{busy?'처리 중…':message}</p>
 </section>;
}
