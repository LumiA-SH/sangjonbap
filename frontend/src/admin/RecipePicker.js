import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';

export default function RecipePicker({value, onChange, disabled, onDenied, required = true, label = '레시피'}) {
 const [rows, setRows] = useState([]);
 const [query, setQuery] = useState('');
 const [after, setAfter] = useState(null);
 const [error, setError] = useState('');
 const [loading, setLoading] = useState(false);
 const sequence = useRef(0);

 async function load(cursor = null) {
  const token = ++sequence.current;
  setLoading(true);

  try {
   const r = await api('/admin/recipes' + (cursor ? '?after=' + cursor : ''));

   if (token === sequence.current) {
    setRows(old => cursor ? [...old, ...r.records] : r.records);
    setAfter(r.nextAfter);
    setError('');
   }
  } catch (e) {
   if (token === sequence.current) {
    setError(e.message);
    if ([401, 403].includes(e.status)) onDenied?.(e.message);
   }
  } finally {
   if (token === sequence.current) setLoading(false);
  }
 }

 useEffect(() => {
  load();

  return () => {
   sequence.current++;
  };
 }, []); // eslint-disable-line react-hooks/exhaustive-deps

 return (
     <div>
      <label>
       {label} 검색
       <input value={query} disabled={disabled} onChange={e => setQuery(e.target.value)}/>
      </label>

      <label>
       {label}
       <select required={required} value={value || ''} disabled={disabled || loading} onChange={e => onChange(e.target.value)}>
        <option value="">선택</option>

        {value && !rows.some(r => String(r.id) === String(value)) && (
            <option value={value}>현재 ID {value}</option>
        )}

        {rows.filter(r => String(r.id) === String(value) || r.name.toLowerCase().includes(query.toLowerCase())).map(r => (
            <option key={r.id} value={r.id}>{r.name} · ID {r.id}</option>
        ))}
       </select>
      </label>

      {after && (
          <button type="button" disabled={disabled || loading} onClick={() => load(after)}>레시피 더 불러오기</button>
      )}

      {error && <p role="alert">{error}</p>}
     </div>
 );
}