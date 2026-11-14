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

 return (
     <section>
      <h2>공용창고 재고 조정</h2>

      <form onSubmit={e => {e.preventDefault(); work(() => load());}}>
       <label>
        아이템 검색
        <input value={q} disabled={busy} onChange={e => setQ(e.target.value)}/>
       </label>
       <button disabled={busy}>검색</button>
      </form>

      <ul>
       {rows.map(r => (
           <li key={r.item_id}>
            {r.name} · 현재 {r.quantity}개
            <button disabled={busy} onClick={() => selectItem(r)}>재고 수정</button>
           </li>
       ))}
      </ul>

      {next && <button disabled={busy} onClick={() => work(() => load(next))}>다음 100건</button>}

      {selected && (
          <form className="admin-form" onSubmit={save}>
           <p>{selected.name}: 변경 전 {selected.quantity} → 변경 후 {quantity}</p>

           <label>
            최종 재고
            <input required type="number" min="0" max="2147483647" step="1" value={quantity} disabled={busy} onChange={e => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}/>
           </label>

           <label>
            수정 사유
            <input required maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)}/>
           </label>

           <button disabled={busy || !Number.isInteger(quantity) || quantity < 0 || quantity > 2147483647 || !reason.trim()}>재고 저장</button>
           <button type="button" disabled={busy} onClick={() => setSelected(null)}>취소</button>
          </form>
      )}

      <p>조회 이후 입출고가 발생하면 저장을 거부합니다. 다시 검색해 현재 수량을 확인하세요.</p>
      <p role="status">{busy ? '처리 중…' : message}</p>
     </section>
 );
}