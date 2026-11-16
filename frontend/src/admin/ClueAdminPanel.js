import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import AdminDeleteControl from './AdminDeleteControl';
import './admin-list-layout.css';

const empty = {
 title: '',
 content: '',
 related_target: null,
 area_id: null,
 is_public: true,
 manually_published: false
};

export default function ClueAdminPanel({onDenied, recordId, onOpen}) {
 const [rows, setRows] = useState([]);
 const [next, setNext] = useState(null);
 const [q, setQ] = useState('');
 const [areas, setAreas] = useState([]);
 const [loaded, setLoaded] = useState(null);
 const [draft, setDraft] = useState(null);
 const [reason, setReason] = useState('');
 const [message, setMessage] = useState('');
 const [busy, setBusy] = useState(false);
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

   if ([401, 403].includes(e.status)) {
    onDenied?.(e.message);
   }
  } finally {
   pending.current = false;
   setBusy(false);
  }
 }

 async function list(after = null) {
  const r = await api('/admin/clues?q=' + encodeURIComponent(q) +
      (after ? '&after=' + after : ''));

  setRows(r.records);
  setNext(r.nextAfter);
 }

 async function open(id) {
  setReason('');

  if (id === 'new') {
   setLoaded(null);
   setDraft({...empty});
   return;
  }

  const r = await api('/admin/clues/' + id);

  setLoaded(r);
  setDraft(Object.fromEntries(
      Object.keys(empty).map(k => [k, r.record[k]])
  ));
 }

 useEffect(() => {
  let active = true;

  setBusy(true);
  setDraft(null);

  (async () => {
   try {
    const [listResult, areaResult, detail] = await Promise.all([
     api('/admin/clues?q='),
     api('/admin/battle-areas'),
     onOpen && recordId && recordId !== 'new'
         ? api('/admin/clues/' + recordId)
         : Promise.resolve(null)
    ]);

    if (!active) return;

    setRows(listResult.records);
    setNext(listResult.nextAfter);
    setAreas(areaResult.records);
    setReason('');
    setLoaded(detail);

    if (recordId === 'new') {
     setDraft({...empty});
    } else if (detail) {
     setDraft(Object.fromEntries(
         Object.keys(empty).map(k => [k, detail.record[k]])
     ));
    }
   } catch (e) {
    if (active) {
     setMessage(e.message);

     if ([401, 403].includes(e.status)) {
      onDenied?.(e.message);
     }
    }
   } finally {
    if (active) setBusy(false);
   }
  })();

  return () => {
   active = false;
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [recordId]);

 const choose = id => onOpen ? onOpen(id) : work(() => open(id));

 async function save(e) {
  e.preventDefault();

  await work(async () => {
   if (!window.confirm('발견 기록을 보존하고 단서 내용을 저장합니까?')) {
    return;
   }

   const r = await api('/admin/clues' +
       (loaded ? '/' + loaded.record.id : ''), {
    method: loaded ? 'PATCH' : 'POST',
    body: {
     ...draft,
     reason,
     expectedVersion: loaded?.version,
     requestKey: crypto.randomUUID()
    }
   });

   setLoaded(r);
   setDraft(Object.fromEntries(
       Object.keys(empty).map(k => [k, r.record[k]])
   ));

   await list();
   setMessage('저장 성공');
  });
 }

 return (
     <section className="admin-record-workspace"><div className="admin-list-pane">
      
      <p>구역 없이 단서를 등록할 수 있습니다. 운영진 직접 공개는 발견자·발견 시각·조사율을 변경하지 않습니다.</p>

      <form onSubmit={e => {
       e.preventDefault();
       work(() => list());
      }}>
       <label>
        단서 검색
        <input value={q} onChange={e => setQ(e.target.value)}/>
       </label>
       <button disabled={busy}>검색</button>
      </form>

      <div className="admin-clue-actions">
       <button disabled={busy} onClick={() => choose('new')}>
        새 단서
       </button>
      </div>

      <ul className="admin-two-column-list admin-clue-list">
       {rows.map(r => (
           <li key={r.id} className="admin-clickable-row" onClick={event=>{
             if(busy||event.target.closest('button, a, input, select, textarea, label, summary, [role="button"], [role="link"], .admin-record-actions, .admin-delete-inline')) return;
             choose(String(r.id));
           }}>
            <div className="admin-list-detail">
             <button type="button" className="admin-entry-title" disabled={busy} aria-current={String(loaded?.record?.id)===String(r.id)?"true":undefined} onClick={()=>choose(String(r.id))}>{r.title}</button>
             <small>
              {r.is_discovered ? '발견' : '미발견'}
              {' · '}
              {!r.is_public ? '비공개' : r.manually_published ? '운영진 직접 공개' : r.is_discovered ? '아카이브 공개' : '발견 대기'}
             </small>
            </div>

             <div className="admin-record-actions">
              <AdminDeleteControl menu="clues" recordId={String(r.id)} disabled={busy} onDenied={onDenied}
                onDeleted={async()=>{
                  if(String(loaded?.record?.id)===String(r.id)||String(recordId)===String(r.id)){
                    setLoaded(null);
                    setDraft(null);
                    setReason('');
                    onOpen?.(null);
                  }
                  await list();
                  setMessage('삭제 완료');
                }}/>
             </div>
           </li>
       ))}
      </ul>

      {next && (
          <button disabled={busy} onClick={() => work(() => list(next))}>
           다음 단서
          </button>
      )}

      </div><div className="admin-detail-pane">
      {draft && (
          <form className="admin-form admin-structured-editor" onSubmit={save}><header className="admin-editor-heading"><small>{loaded?'수정 / 단서':'신규 등록'}</small><h3>{draft.title||'새 단서'}</h3></header><section className="admin-editor-section"><h4>단서 기본 정보</h4><div className="admin-editor-grid">
           <label>
            제목
            <input required maxLength={100} disabled={busy}
                   value={draft.title}
                   onChange={e => setDraft({...draft, title: e.target.value})}/>
           </label>

           <label className="admin-field-wide">
            내용
            <textarea maxLength={10000} disabled={busy}
                      value={draft.content}
                      onChange={e => setDraft({...draft, content: e.target.value})}/>
           </label>

           <label>
            관련 대상
            <input maxLength={200} disabled={busy}
                   value={draft.related_target || ''}
                   onChange={e => setDraft({
                    ...draft,
                    related_target: e.target.value || null
                   })}/>
           </label>

           <label>
            관련 구역 (선택)
            <select disabled={busy}
                    value={draft.area_id || ''}
                    onChange={e => setDraft({...draft, area_id: e.target.value || null})}>
             <option value="">구역 지정 안 함</option>
             {areas.map(a => (
                 <option key={a.id} value={a.id}>{a.name}</option>
             ))}
            </select>
           </label>

           </div></section><section className="admin-editor-section"><h4>공개 · 발견 상태</h4><label>
            아카이브 공개 허용
            <input type="checkbox" disabled={busy}
                   checked={draft.is_public}
                   onChange={e => setDraft({
                    ...draft,
                    is_public: e.target.checked
                   })}/>
           </label>

           <label>
            운영진 직접 공개 (발견 전에도 아카이브 표시)
            <input type="checkbox" disabled={busy} checked={!!draft.manually_published}
                   onChange={e=>setDraft({...draft,manually_published:e.target.checked})}/>
           </label>
           <p>아카이브 표시: {!draft.is_public ? '비공개' : draft.manually_published || loaded?.record.is_discovered ? '공개' : '발견 대기'}</p>
           {!loaded && <p>발견 여부: 미발견 (신규 단서)</p>}
           {loaded && (
               <p>
                발견 여부: {loaded.record.is_discovered ? '발견' : '미발견'} ·
                최초 발견자 ID {loaded.record.first_discoverer_id || '-'} ·
                {loaded.record.discovered_at || '-'}
               </p>
           )}

           <label>
            수정 사유
            <input required maxLength={500} disabled={busy}
                   value={reason}
                   onChange={e => setReason(e.target.value)}/>
           </label>

           </section><details className="admin-wide">
            <summary>변경 전후 비교</summary>
            <pre>{JSON.stringify({
             before: loaded?.record || null,
             after: draft
            }, null, 2)}</pre>
           </details>

           <footer className="admin-editor-footer"><button disabled={busy}>단서 저장</button></footer>
          </form>
      )}

      <p role="status">{busy ? '처리 중…' : message}</p>
      {!draft&&<p className="admin-empty-detail">목록에서 단서를 선택하거나 새로 등록하세요.</p>}
      </div></section>
 );
}