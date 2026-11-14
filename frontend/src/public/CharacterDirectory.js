import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import PublicCharacterPanel from '../dev/PublicCharacterPanel';
import './public.css';

export default function CharacterDirectory({recordId, onOpen, onBack, canReadDetails}) {
 const [query, setQuery] = useState('');
 const [rows, setRows] = useState([]);
 const [next, setNext] = useState(null);
 const [record, setRecord] = useState(null);
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const sequence = useRef(0);

 async function search(after = null) {
  const id = ++sequence.current;
  setBusy(true);
  setError('');

  try {
   const r = await api('/public/characters?q=' + encodeURIComponent(query) + (after ? '&after=' + after : ''));

   if (id === sequence.current) {
    setRows(r.records);
    setNext(r.nextAfter);
   }
  } catch (e) {
   if (id === sequence.current) setError(e.message);
  } finally {
   if (id === sequence.current) setBusy(false);
  }
 }

 useEffect(() => {
  search();

  return () => {
   sequence.current++;
  };
 }, []); // eslint-disable-line react-hooks/exhaustive-deps

 useEffect(() => {
  let live = true;

  setRecord(null);
  setError('');

  if (recordId) {
   api('/public/characters/' + recordId)
       .then(r => {
        if (live) setRecord(r.character);
       })
       .catch(e => {
        if (live) setError(e.message);
       });
  }

  return () => {
   live = false;
  };
 }, [recordId]);

 const profile = c => (
     <p>
      헌터 {c.hunter_grade} ·
      이능 {c.has_ability ? (c.ability_grade || '미등록') : '없음'} ·
      상태 {{ALIVE: '생존', NEAR_DEATH: '빈사', DEAD: '사망'}[c.status] || c.status}
     </p>
 );

 return (
     <section className="survival-card public-content">
      <h2>공개 캐릭터 목록</h2>
      {error && <p role="alert">{error}</p>}

      {recordId ? (
          <>
           <button onClick={onBack}>목록으로 돌아가기</button>

           {!record && !error ? (
               <p>상세 조회 중…</p>
           ) : record && (
               <>
                <h3>{record.name}</h3>
                {profile(record)}

                {canReadDetails ? (
                    <PublicCharacterPanel key={record.id} targetId={record.id}/>
                ) : (
                    <p>자원·인벤토리 상세는 캐릭터가 연결된 러너로 로그인한 뒤 확인할 수 있습니다.</p>
                )}
               </>
           )}
          </>
      ) : (
          <>
           <form onSubmit={e => {e.preventDefault(); search();}}>
            <label>
             캐릭터명 검색
             <input maxLength={100} value={query} onChange={e => setQuery(e.target.value)}/>
            </label>
            <button disabled={busy}>검색</button>
           </form>

           {busy ? (
               <p role="status">조회 중…</p>
           ) : rows.length ? (
               <ul>
                {rows.map(c => (
                    <li key={c.id}>
                     <button onClick={() => onOpen(c.id)}>{c.name}</button>
                     {profile(c)}
                    </li>
                ))}
               </ul>
           ) : (
               !error && <p>공개된 캐릭터가 없습니다.</p>
           )}

           {next && <button disabled={busy} onClick={() => search(next)}>다음 캐릭터</button>}
          </>
      )}
     </section>
 );
}