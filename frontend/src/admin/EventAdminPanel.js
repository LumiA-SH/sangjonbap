import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import ImageUploadField from './ImageUploadField';
import '../public/events.css';

const empty = () => ({
 title: '',
 body: '',
 imageUrl: null,
 startAt: null,
 endAt: null,
 active: false,
 featured: false
});

const editable = r => Object.fromEntries(Object.keys(empty()).map(k => [k, r[k]]));
const local = value => value ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16) : '';
const display = value => value ? new Date(value).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'}) : '제한 없음';

export default function EventAdminPanel({onDenied, recordId, onOpen}) {
 const [data, setData] = useState(null);
 const [draft, setDraft] = useState(empty);
 const [message, setMessage] = useState('');
 const [busy, setBusy] = useState(false);
 const [uploading, setUploading] = useState(false);
 const pending = useRef(false);

 const selected = data?.records.find(r => r.id === recordId);

 async function work(fn) {
  if (pending.current) return;

  pending.current = true;
  setBusy(true);
  setMessage('');

  try {
   await fn();
  } catch (e) {
   setMessage(e.message);
   if ([401, 403].includes(e.status)) onDenied?.(e.message);
  } finally {
   pending.current = false;
   setBusy(false);
  }
 }

 const load = async () => setData(await api('/admin/events'));

 useEffect(() => {
  work(load);
 }, []); // eslint-disable-line react-hooks/exhaustive-deps

 useEffect(() => {
  setDraft(selected ? editable(selected) : empty());
 }, [selected, recordId]);

 const change = (key, value) => setDraft(old => ({...old, [key]: value}));

 async function save(e) {
  e.preventDefault();
  if (uploading || !data) return;

  await work(async () => {
   if (!window.confirm('이벤트 내용과 공개 기간을 확인하고 저장합니까?')) return;

   const result = await api('/admin/events' + (selected ? '/' + selected.id : ''), {
    method: selected ? 'PATCH' : 'POST',
    body: {
     record: draft,
     expectedVersion: data.version,
     requestKey: crypto.randomUUID()
    }
   });

   setData(result);
   onOpen(result.record.id);
   setMessage('이벤트를 저장했습니다.');
  });
 }

 async function remove(row) {
  await work(async () => {
   if (!window.confirm('이벤트 「' + row.title + '」을 삭제합니까?')) return;

   setData(await api('/admin/events/' + row.id, {
    method: 'DELETE',
    body: {
     expectedVersion: data.version,
     requestKey: crypto.randomUUID()
    }
   }));

   onOpen(null);
   setMessage('이벤트를 삭제했습니다.');
  });
 }

 return (
     <section className="admin-record-workspace event-admin">
      <div className="admin-list-pane">
       <button type="button" disabled={busy} onClick={() => onOpen('new')}>이벤트 등록</button>
       <button type="button" disabled={busy} onClick={() => work(load)}>목록 새로고침</button>

       {!data ? (
           <p>이벤트를 불러오는 중입니다.</p>
       ) : !data.records.length ? (
           <p>등록된 이벤트가 없습니다.</p>
       ) : (
           <ul className="event-admin-list">
            {data.records.map(row => (
                <li key={row.id}>
                 <button type="button" className="event-record-select" disabled={busy} onClick={() => onOpen(row.id)} aria-pressed={row.id === recordId}>
                  {row.imageUrl && <img src={row.imageUrl} alt=""/>}
                  <strong>{row.title}</strong>
                  <span>{row.active ? '활성' : '비활성'}{row.featured ? ' · 홈 대표' : ''}</span>
                  <small>등록: {display(row.createdAt)}</small>
                  <small>시작: {display(row.startAt)}</small>
                  <small>종료: {display(row.endAt)}</small>
                 </button>
                 <button type="button" disabled={busy} onClick={() => onOpen(row.id)}>수정</button>
                 <button type="button" disabled={busy} onClick={() => remove(row)}>삭제</button>
                </li>
            ))}
           </ul>
       )}
      </div>

      <div className="admin-editor-pane">
       {data && (recordId === 'new' || selected) ? (
           <form onSubmit={save}>
            <h3>{selected ? '이벤트 수정' : '이벤트 등록'}</h3>

            <fieldset disabled={busy || uploading}>
             <label>
              이벤트 제목
              <input required maxLength={100} value={draft.title} onChange={e => change('title', e.target.value)}/>
             </label>

             <label>
              이벤트 내용
              <textarea required rows={12} maxLength={3000} value={draft.body} onChange={e => change('body', e.target.value)}/>
             </label>

             <ImageUploadField label="이벤트 이미지" kind="events" value={draft.imageUrl} onChange={value => change('imageUrl', value)} disabled={busy} onDenied={onDenied} onUploadingChange={setUploading}/>

             {['startAt', 'endAt'].map(key => (
                 <label key={key}>
                  {key === 'startAt' ? '게시 시작일' : '게시 종료일'} (KST)
                  <input type="datetime-local" min="2000-01-01T00:00" max="9999-12-31T23:59" value={local(draft[key])} onChange={e => change(key, e.target.value ? e.target.value + ':00+09:00' : null)}/>
                 </label>
             ))}

             <p>시작 시각부터 공개하고 종료 시각부터 숨깁니다. 비워두면 해당 경계는 제한하지 않습니다.</p>

             <label>
              <input type="checkbox" checked={draft.active} onChange={e => change('active', e.target.checked)}/>
              활성
             </label>

             <label>
              <input type="checkbox" checked={draft.featured} onChange={e => change('featured', e.target.checked)}/>
              홈 대표 배너
             </label>

             <p>대표 이벤트는 한 건만 지정할 수 있습니다. 변경하려면 기존 대표 지정을 먼저 해제하세요.</p>
            </fieldset>

            <details>
             <summary>변경 전후 비교</summary>
             <pre>{JSON.stringify({before: selected || null, after: draft}, null, 2)}</pre>
            </details>

            <button disabled={busy || uploading}>저장</button>
            {selected && <button type="button" disabled={busy || uploading} onClick={() => remove(selected)}>삭제</button>}
           </form>
       ) : (
           <p>왼쪽에서 이벤트를 선택하거나 새로 등록하세요.</p>
       )}

       <p role="status">{busy ? '처리 중…' : message}</p>
      </div>
     </section>
 );
}