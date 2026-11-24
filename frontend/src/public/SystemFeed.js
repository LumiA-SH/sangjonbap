import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import {subscribeSystemFeed} from './systemFeedUpdates';
import './SystemFeed.css';

export const feedTitles = {
 activity: '최근 기록',
 notice: '공지사항',
 event: '이벤트'
};

export default function SystemFeed({kind = 'activity', preview = false, active = true, onMore}) {
 const [data, setData] = useState(null);
 const [error, setError] = useState('');
 const [connectionError, setConnectionError] = useState('');
 const [loading, setLoading] = useState(false);

 const connection = useRef(null);
 const request = useRef(null);
 const busy = useRef(false);
 const snapshot = useRef(null);
 const cursor = useRef(null);
 const refreshQueued = useRef(false);
 const refreshRef = useRef(() => {});

 async function load(before = null, background = false) {
  if (busy.current) return;

  busy.current = true;
  cursor.current = before;

  const sequence = {};
  request.current = sequence;
  setLoading(true);
  setError('');

  try {
   const path = `/public/system-feed?kind=${kind}${before ? '&before=' + encodeURIComponent(before) : ''}`;
   const result = await (background ? api(path, {background: true}) : api(path));

   if (request.current === sequence) {
    snapshot.current = result;
    setData(result);
   }
  } catch (e) {
   if (request.current === sequence) {
    if (e.status === 401 || e.status === 403) {
     snapshot.current = null;
     setData(null);
    }

    setError(e.message || '게시글을 불러오지 못했습니다.');
   }
  } finally {
   if (request.current === sequence) {
    busy.current = false;
    setLoading(false);

    if (refreshQueued.current) {
     refreshQueued.current = false;
     refreshRef.current();
    }
   }
  }
 }

 useEffect(() => {
  if (!active) {
   request.current = null;
   busy.current = false;
   snapshot.current = null;
   setData(null);
   setConnectionError('');
   return;
  }

  load();

  async function refresh() {
   if (document.visibilityState === 'hidden' || cursor.current) return;

   if (busy.current) {
    refreshQueued.current = true;
    return;
   }

   busy.current = true;

   const sequence = {};
   request.current = sequence;

   try {
    const result = await api('/public/system-feed/revision', {background: true});
    if (request.current !== sequence) return;

    busy.current = false;
    setError('');

    if (!snapshot.current || result.enabled !== snapshot.current.enabled ||
        (result.enabled && result.revision !== snapshot.current.revision)) {
     await load(null, true);
    }
   } catch (e) {
    if (request.current === sequence) {
     if (e.status === 401 || e.status === 403) {
      snapshot.current = null;
      setData(null);
     }

     setError(e.message || '새 게시글 확인에 실패했습니다.');
    }
   } finally {
    if (request.current === sequence) {
     busy.current = false;

     if (refreshQueued.current) {
      refreshQueued.current = false;
      refresh();
     }
    }
   }
  }

  refreshRef.current = refresh;

  const stop = subscribeSystemFeed({
   onChange: refresh,
   onConnected: () => setConnectionError(''),
   onError: e => {
    if (e.status === 401 || e.status === 403) {
     snapshot.current = null;
     setData(null);
    }

    setConnectionError(e.message || '실시간 연결을 확인하세요.');
   }
  });

  connection.current = stop;

  return () => {
   request.current = null;
   busy.current = false;
   refreshQueued.current = false;
   refreshRef.current = () => {};
   connection.current = null;
   stop();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [kind, active, preview]);

 const records = data?.records || [];
 const visibleRecords = preview ? records.slice(0, 5) : records;

 function formatDate(date) {
  return new Intl.DateTimeFormat('ko-KR', {
   timeZone: 'Asia/Seoul',
   year: '2-digit',
   month: '2-digit',
   day: '2-digit',
   hour: '2-digit',
   minute: '2-digit',
   hour12: false
  }).format(new Date(date));
 }

 return (
     <div className={`system-feed ${preview ? 'system-feed-preview' : 'system-feed-full'}`} aria-label={`${feedTitles[kind]} 게시글`}>
      {loading && !data && <p role="status">게시글을 불러오는 중입니다.</p>}

      {(error || connectionError) && (
          <div className="system-feed-error" role="alert">
           <span>{error || connectionError}</span>
           <button type="button" onClick={() => {connection.current?.retry?.(); load();}}>다시 불러오기</button>
          </div>
      )}

      {data?.enabled === false && (
          <div className="survival-empty">
           <p>시스템 계정 게시글 연동 준비 중입니다.</p>
          </div>
      )}

      {data?.enabled && records.length === 0 && (
          <p className="system-feed-empty">표시할 게시글이 없습니다.</p>
      )}

      {visibleRecords.length > 0 && (
          <ul className="system-feed-list">
           {visibleRecords.map(record => (
               <li className="system-feed-item" key={record.id}>
                <div className="system-feed-meta">
                 <time dateTime={record.createdAt}>{formatDate(record.createdAt)} KST</time>
                 {record.boosted && <span className="system-feed-boost">BOOST</span>}
                </div>

                {record.warning ? (
                    <details className="system-feed-warning">
                     <summary>{record.warning}</summary>
                     <p className="system-feed-text">{record.text}</p>
                    </details>
                ) : (
                    <p className="system-feed-text">{record.text}</p>
                )}
               </li>
           ))}
          </ul>
      )}

      {preview && onMore && data?.enabled && (
          <button type="button" className="survival-card-link" onClick={onMore}>더보기 ›</button>
      )}

      {!preview && data?.enabled && (
          <div className="system-feed-pagination">
           <button type="button" disabled={loading} onClick={() => load()}>최신 게시글</button>
           {data.nextBefore && (
               <button type="button" disabled={loading} onClick={() => load(data.nextBefore)}>이전 게시글</button>
           )}
          </div>
      )}
     </div>
 );
}