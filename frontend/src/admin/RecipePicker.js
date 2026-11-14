import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';

export default function RecipePicker({
                                      value,
                                      onChange,
                                      disabled = false,
                                      onDenied,
                                      required = true,
                                      label = '레시피'
                                     }) {
 const [rows, setRows] = useState([]);
 const [selected, setSelected] = useState(null);
 const [query, setQuery] = useState('');
 const [after, setAfter] = useState(null);
 const [error, setError] = useState('');
 const [loading, setLoading] = useState(false);

 const sequence = useRef(0);
 const selectionSequence = useRef(0);

 async function load(cursor = null) {
  const token = ++sequence.current;

  setLoading(true);
  setError('');

  try {
   const data = await api('/admin/recipes' + (cursor ? `?after=${cursor}` : ''));

   if (token !== sequence.current) return;

   setRows(previous =>
       cursor ? [...previous, ...data.records] : data.records
   );

   setAfter(data.nextAfter);
  } catch (e) {
   if (token !== sequence.current) return;

   setError(`${e.code || 'LOAD_FAILED'}: ${e.message}`);

   if ([401, 403].includes(e.status)) {
    onDenied?.(e.message);
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 useEffect(() => {
  const token = ++selectionSequence.current;

  if (!value) {
   setSelected(null);
   return;
  }

  const existing = rows.find(row => String(row.id) === String(value));

  if (existing) {
   setSelected(existing);
   return;
  }

  api(`/admin/recipes/${encodeURIComponent(String(value))}`)
      .then(data => {
       if (token === selectionSequence.current) {
        setSelected(data.record);
       }
      })
      .catch(e => {
       if (token !== selectionSequence.current) return;

       setError(`선택된 레시피의 이름을 불러오지 못했습니다: ${e.message}`);

       if ([401, 403].includes(e.status)) {
        onDenied?.(e.message);
       }
      });

  return () => {
   selectionSequence.current++;
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [value, rows]);

 const filtered = rows.filter(row =>
     String(row.id) === String(value) ||
     row.name.toLowerCase().includes(query.trim().toLowerCase())
 );

 const selectedInList = filtered.some(row => String(row.id) === String(value));

 return (
     <div className="admin-recipe-picker">
      <label>
       {label} 이름 검색
       <input
           type="search"
           value={query}
           placeholder="레시피 이름 입력"
           disabled={disabled}
           onChange={event => setQuery(event.target.value)}
       />
      </label>

      <label>
       {label} 선택
       <select
           required={required}
           value={value || ''}
           disabled={disabled || loading}
           onChange={event => onChange(event.target.value)}
       >
        <option value="">레시피 선택</option>

        {!selectedInList && value && selected && (
            <option value={value}>{selected.name}</option>
        )}

        {filtered.map(row => (
            <option key={row.id} value={row.id}>
             {row.name}
            </option>
        ))}
       </select>
      </label>

      {selected && String(selected.id) === String(value) && (
          <p role="status">
           선택된 레시피: <strong>{selected.name}</strong>
          </p>
      )}

      {after && (
          <button type="button" disabled={disabled || loading} onClick={() => load(after)}>
           레시피 더 불러오기
          </button>
      )}

      {loading && <p role="status">레시피 목록을 불러오는 중…</p>}
      {error && <p role="alert">{error}</p>}
     </div>
 );
}