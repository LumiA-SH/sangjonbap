import {useRef,useState} from 'react';
import {api} from '../api/client';

// Selection stores only the ID. Names never identify a game item.
export default function ItemPicker({value,onChange,disabled=false,label='아이템',onDenied=()=>{}}) {
  const [query,setQuery]=useState(''),[rows,setRows]=useState([]),[message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const sequence=useRef(0);
  async function search() {
    const version=++sequence.current;
    if(!query.trim()){setRows([]);setMessage('이름을 입력하세요.');return;}
    setBusy(true);setMessage('');
    try {
      const data=await api(`/admin/items/search?q=${encodeURIComponent(query.trim())}`);
      if(version===sequence.current){setRows(data.records);setMessage(data.records.length?'최대 30건입니다. 이름을 더 입력하여 좁힐 수 있습니다.':'검색 결과가 없습니다.');}
    } catch(e){if(version===sequence.current){setRows([]);setMessage(`${e.code}: ${e.message}`);if([401,403].includes(e.status))onDenied(e.message);}}
    finally{if(version===sequence.current)setBusy(false);}
  }
  return <div className="admin-item-picker">
    <label>{label} 이름 검색<input value={query} maxLength={100} disabled={disabled} onChange={e=>{sequence.current++;setBusy(false);setQuery(e.target.value);setRows([]);}}
      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();search();}}}/></label>
    <button type="button" disabled={disabled||busy} onClick={search}>{busy?'검색 중…':'아이템 검색'}</button>
    <p role="status">{message}</p>
    <ul>{rows.map(row=><li key={row.id}>{row.name} · ID {row.id} · {row.category} · {row.is_active?'활성':'비활성'}
      <button type="button" disabled={disabled} onClick={()=>{onChange(String(row.id),row);setRows([]);setMessage(`${row.name} · ID ${row.id} · ${row.category} 선택됨`);}}>선택</button></li>)}</ul>
    <details><summary>선택 ID 확인 / 직접 입력</summary><label>{label} ID<input value={value??''} disabled={disabled} onChange={e=>onChange(e.target.value||null)}/></label></details>
    <span>선택 ID: {value||'없음'}</span>
  </div>;
}
