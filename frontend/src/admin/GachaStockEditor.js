import {useCallback, useRef, useState} from 'react';
import {api} from '../api/client';
import './GachaStockEditor.css';
import ItemPicker from './ItemPicker';
import AdminReferenceName, {invalidateAdminNames} from './AdminReferenceName';

export default function GachaStockEditor({record, onSaved, onDenied, onBusy}) {
  const [draft, setDraft] = useState(() => ({
    name: record?.name || '',
    price: 1,
    is_active: record?.is_active ?? false,
    start_at: record?.start_at ?? null,
    end_at: record?.end_at ?? null,
    rewards: (record?.rewards || []).map(r => ({...r, quantity: r.quantity ?? 1, weight: r.weight ?? 1}))
  }));

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [resolvedNames, setResolvedNames] = useState({});
  const sending = useRef(false);

  const rows = draft.rewards;

  const total = rows
      .filter(r => r.is_active !== false)
      .reduce((sum, r) => sum + (Number(r.remaining_stock) || 0), 0);

  const weightTotal=rows.filter(r=>r.is_active!==false&&r.remaining_stock>0).reduce((sum,r)=>sum+(Number(r.weight)||0),0);
  const normalizedQuery = query.trim().toLowerCase();

  const handleNameResolved = useCallback((key, name) => {
    setResolvedNames(previous => {
      if (previous[key] === name) return previous;
      return {...previous, [key]: name};
    });
  }, []);

  const filtered = rows.map((row, index) => ({row, index}))
      .filter(({row}) => {
        if (!normalizedQuery) return true;

        const name = row.name || resolvedNames[`items:${row.item_id}`] || '';
        return name.toLowerCase().includes(normalizedQuery) ||
            (row.item_id && !name);
      });

  function change(index, patch) {
    setDraft(current => ({
      ...current,
      rewards: current.rewards.map((row, i) =>
          i === index ? {...row, ...patch} : row
      )
    }));
  }

  async function save(event) {
    event.preventDefault();
    if (sending.current) return;

    if (new Set(rows.map(r => r.item_id)).size !== rows.length) {
      setMessage('아이템 중복 등록은 불가합니다.');
      return;
    }

    if (rows.some(r =>
        (r.max_stock == null || r.remaining_stock == null) &&
        r.is_active !== false
    )) {
      setMessage('재고 미확정 항목은 전환 HOLD입니다. 행 제외로 비활성화할 수 있습니다.');
      return;
    }

    if(rows.some(r=>!r.item_id||!Number.isInteger(r.quantity)||r.quantity<1||!Number.isInteger(r.weight)||r.weight<1)){
      setMessage('보상 아이템과 1 이상의 정수 지급 수량·가중치를 입력하세요.');return;
    }
    if(!window.confirm('가챠 설정을 저장합니까? 기존 당첨 기록은 유지됩니다.'))return;
    sending.current = true;
    setBusy(true);
    onBusy(true);
    setMessage('');

    try {
      const body = {
        ...draft,
        rewards: rows.map(row => ({
          item_id: String(row.item_id),
          quantity: row.quantity,
          weight: row.weight,
          is_active: row.is_active !== false,
          max_stock: row.max_stock,
          remaining_stock: row.remaining_stock
        })),
        requestKey: crypto.randomUUID()
      };

      const saved = await api(`/admin/gachas${record ? `/${record.id}` : ''}`, {
        method: record ? 'PATCH' : 'POST',
        body
      });

      invalidateAdminNames();
      await onSaved(saved.record);
    } catch (e) {
      setMessage(`${e.code || 'SAVE_FAILED'}: ${e.message}`);

      if ([401, 403].includes(e.status)) {
        onDenied(e.message);
      }
    } finally {
      sending.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  return <form className="admin-form admin-structured-editor gacha-settings" onSubmit={save}>
    <header className="admin-editor-heading admin-editor-heading-actions"><h3>{record?'가챠 설정':'새 가챠 등록'}</h3><label><input type="checkbox" checked={draft.is_active} disabled={busy} onChange={e=>setDraft({...draft,is_active:e.target.checked})}/>가챠 활성화</label></header>
    <section className="admin-editor-section"><label>가챠 이름<input required maxLength={100} value={draft.name} disabled={busy} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label>가격 (코인)<input type="number" value={1} readOnly/></label>
    <details><summary>운영 기간 설정</summary>{['start_at','end_at'].map(key=><label key={key}>{key==='start_at'?'시작':'종료'} 시각 (시간대 포함 ISO)<input value={draft[key]||''} disabled={busy} onChange={e=>setDraft({...draft,[key]:e.target.value||null})}/></label>)}</details></section>
    <section className="admin-editor-section"><div className="admin-toolbar-actions"><h4>보상 목록</h4><button type="button" disabled={busy} onClick={()=>{setQuery('');setPage(Math.floor(rows.length/20));setDraft({...draft,rewards:[...rows,{item_id:'',quantity:1,weight:1,is_active:true,max_stock:1,remaining_stock:1}]});}}>보상 추가</button></div>
    <label>보상 검색<input type="search" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label>
    <div className="gacha-table-wrap"><table className="gacha-reward-table"><thead><tr><th>보상</th><th>종류</th><th>지급 수량</th><th>가중치</th><th>예상 확률</th><th>삭제</th></tr></thead><tbody>
    {filtered.slice(page*20,page*20+20).map(({row,index})=><tr key={row.id||index}>
      <td data-label="보상">{row.id?<AdminReferenceName itemId={row.item_id} eager onResolved={handleNameResolved} onDenied={onDenied}/>:<ItemPicker label="보상 아이템" value={row.item_id} disabled={busy} onDenied={onDenied} onChange={(id,item)=>change(index,{item_id:id,name:item?.name||'',category:item?.category})}/>}
      <details><summary>활성 설정</summary><label><input type="checkbox" checked={row.is_active!==false} disabled={busy} onChange={e=>change(index,{is_active:e.target.checked})}/>보상 활성</label>
      <label>최대 당첨 횟수<input type="number" min="1" max="2147483647" step="1" required={row.is_active!==false} disabled={busy} value={row.max_stock??''} onChange={e=>{const max=e.target.value===''?null:Number(e.target.value);const issued=row.max_stock==null?0:row.max_stock-row.remaining_stock;change(index,{max_stock:max,remaining_stock:max==null?null:max-issued});}}/></label>
      <p>남은 당첨 횟수: {row.remaining_stock??'미설정'} · 누적 당첨: {row.max_stock==null?'미확정':row.max_stock-row.remaining_stock}</p></details></td>
      <td data-label="종류">{row.category?({MATERIAL:'재료',CONSUMABLE:'소비품',FOOD:'음식',ETC:'기타'})[row.category]||'아이템':'아이템·음식'}</td>
      <td data-label="지급 수량"><input aria-label="지급 수량" required type="number" min="1" max="2147483647" step="1" disabled={busy} value={row.quantity} onChange={e=>change(index,{quantity:e.target.value===''?'':Number(e.target.value)})}/></td>
      <td data-label="가중치"><input aria-label="가중치" required type="number" min="1" max="2147483647" step="1" disabled={busy} value={row.weight} onChange={e=>change(index,{weight:e.target.value===''?'':Number(e.target.value)})}/></td>
      <td data-label="예상 확률">{row.is_active!==false&&row.remaining_stock>0&&weightTotal?(row.weight/weightTotal*100).toFixed(2):'0.00'}%</td>
      <td data-label="삭제"><button type="button" disabled={busy} onClick={()=>{setDraft({...draft,rewards:rows.filter((_,i)=>i!==index)});setPage(0);}}>삭제</button></td>
    </tr>)}
    {!filtered.length&&<tr><td colSpan="6">등록된 보상이 없습니다.</td></tr>}</tbody></table></div>
    <div className="admin-toolbar-actions"><button type="button" disabled={page===0} onClick={()=>setPage(page-1)}>이전 보상</button><button type="button" disabled={(page+1)*20>=filtered.length} onClick={()=>setPage(page+1)}>다음 보상</button></div>
    <p>가중치가 클수록 당첨 확률이 높습니다. 품절·비활성 보상은 제외합니다. 남은 당첨 횟수 {total}회. 1회 당첨 시 설정한 수량을 지급하고 재고 횟수는 1 차감합니다.</p></section>
    <footer className="admin-editor-footer"><button disabled={busy}>가챠 저장</button><p role="alert">{message}</p></footer>
  </form>;
}
