import {useEffect, useState} from 'react';
import {api} from '../api/client';
import './NoticeFeed.css';

export default function NoticeFeed({preview = false, active = true, onMore, onOpen, selectedId = null, onBack}) {
 const [data, setData] = useState(null);
 const [error, setError] = useState('');
 const [attempt, setAttempt] = useState(0);

 useEffect(() => {
  let live = true;

  setData(null);
  setError('');

  if (active) {
   api('/public/guides/notice')
       .then(result => {
        if (live) setData(result);
       })
       .catch(e => {
        if (live) setError(e.message);
       });
  }

  return () => {
   live = false;
  };
 }, [active, attempt]);

 const items = data?.content?.items || [];
 const selected = selectedId == null
     ? null
     : items.find(item => String(item.id) === String(selectedId));

 function openNotice(item) {
  if (onOpen) onOpen(item.id);
 }

 if (error) {
  return (
      <div className="survival-notice-feed">
       <p role="alert">{error}</p>
       <button type="button" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button>
      </div>
  );
 }

 if (!data) {
  return <p className="survival-notice-status" role="status">공지사항을 불러오는 중입니다.</p>;
 }

 if (selectedId != null) {
  return (
      <div className="survival-notice-detail">
       {selected ? (
           <>
            <header className="survival-notice-detail-header">
             <span className="survival-notice-category">NOTICE</span>
             <h3>{selected.title}</h3>
            </header>

            <div className="survival-notice-detail-body">
             {selected.body}
            </div>
           </>
       ) : (
           <p className="survival-notice-status">해당 공지사항을 찾을 수 없습니다.</p>
       )}

       {onBack && (
           <div className="survival-notice-detail-actions">
            <button type="button" onClick={onBack}>목록으로 돌아가기</button>
           </div>
       )}
      </div>
  );
 }

 return (
     <div className={`survival-notice-feed${preview ? ' is-preview' : ''}`} aria-label="공지사항 목록">
      {!items.length ? (
          <p className="survival-notice-status">등록된 공지사항이 없습니다.</p>
      ) : (
          <ul className="survival-notice-list">
           {(preview ? items.slice(0, 3) : items).map(item => (
               <li className="survival-notice-item" key={item.id}>
                <button type="button" className="survival-notice-open" onClick={() => openNotice(item)}>
                 <span className="survival-notice-item-title">{item.title}</span>
                 <span className="survival-notice-arrow" aria-hidden="true">›</span>
                </button>
               </li>
           ))}
          </ul>
      )}

      {preview && onMore && (
          <button type="button" className="survival-card-link" onClick={onMore}>더보기 ›</button>
      )}
     </div>
 );
}