import {useEffect, useState} from 'react';
import {api} from '../api/client';
import './events.css';

const date = value => value ? new Date(value).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'}) : '제한 없음';

function EventImage({src, className, alt}) {
 const [failed, setFailed] = useState(null);

 return src && failed !== src ? (
     <img src={src} className={className} alt={alt} onError={() => setFailed(src)}/>
 ) : null;
}

export default function EventFeed({banner = false, active = true, recordId = null, onOpen, onBack}) {
 const [data, setData] = useState(null);
 const [error, setError] = useState('');
 const [attempt, setAttempt] = useState(0);

 useEffect(() => {
  let live = true;

  setData(null);
  setError('');

  if (active) {
   api('/public/events' + (banner ? '/featured' : recordId ? '/' + recordId : ''))
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
 }, [banner, active, recordId, attempt]);

 if (!active) return null;

 if (error) {
  return (
      <p role="alert">
       {error} <button type="button" onClick={() => setAttempt(v => v + 1)}>다시 불러오기</button>
       {recordId && <button type="button" onClick={onBack}>목록으로 돌아가기</button>}
      </p>
  );
 }

 if (!data) return <p role="status">이벤트를 불러오는 중입니다.</p>;

 if (banner) {
  const row = data.record;

  return row ? (
      <button type="button" className="survival-event-banner event-banner-link" onClick={() => onOpen(row.id)} aria-label={row.title + ' 상세 보기'}>
       <EventImage src={row.imageUrl} className="survival-event-image" alt=""/>
       <div className="survival-event-overlay">
        <span>EVENT</span>
        <strong>{row.title}</strong>
        <small>{row.body.slice(0, 100)}{row.body.length > 100 ? '…' : ''}</small>
       </div>
      </button>
  ) : (
      <div className="survival-event-banner">
       <div className="survival-event-overlay">
        <span>EVENT</span>
        <strong>이벤트 안내</strong>
        <small>현재 공개 중인 대표 이벤트가 없습니다.</small>
       </div>
      </div>
  );
 }

 if (recordId) {
  const row = data.record;

  return (
      <article className="public-event-detail">
       <h3>{row.title}</h3>
       <EventImage src={row.imageUrl} alt={row.title}/>
       <p>게시 기간 (KST): {date(row.startAt)} ~ {date(row.endAt)}</p>
       <p className="event-body">{row.body}</p>
       <button type="button" onClick={onBack}>목록으로 돌아가기</button>
      </article>
  );
 }

 return data.records.length ? (
     <div className="public-event-list">
      {data.records.map(row => (
          <button type="button" key={row.id} className="public-event-card" onClick={() => onOpen(row.id)}>
           <EventImage src={row.imageUrl} alt=""/>
           <strong>{row.title}</strong>
           <small>게시일 (KST): {date(row.startAt || row.createdAt)}</small>
          </button>
      ))}
     </div>
 ) : (
     <p>등록된 이벤트가 없습니다.</p>
 );
}