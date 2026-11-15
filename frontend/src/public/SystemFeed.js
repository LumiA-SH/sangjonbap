import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';

export const feedTitles={activity:'최근 기록',notice:'공지사항',event:'이벤트'};
export default function SystemFeed({kind='activity',preview=false,active=true,onMore}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const request=useRef(null);
 async function load(before=null){
  const sequence={};request.current=sequence;setLoading(true);setError('');setData(null);
  try{const result=await api(`/public/system-feed?kind=${kind}${before?'&before='+encodeURIComponent(before):''}`);if(request.current===sequence)setData(result);}
  catch(e){if(request.current===sequence)setError(e.message||'게시글을 불러오지 못했습니다.');}
  finally{if(request.current===sequence)setLoading(false);}
 }
 useEffect(()=>{
  if(!active){request.current=null;return;}
  load();
  const refresh=()=>{if(document.visibilityState!=='hidden')load();};
  // Preview cards refresh together; the server shares one cached System timeline.
  const timer=preview?setInterval(refresh,60000):null;
  window.addEventListener('focus',refresh);
  return()=>{request.current=null;if(timer)clearInterval(timer);window.removeEventListener('focus',refresh);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[kind,active,preview]);
 const records=data?.records||[];
 return <div aria-label={`${feedTitles[kind]} 게시글`}>
  {loading&&<p role="status">게시글을 불러오는 중입니다.</p>}
  {error&&<p role="alert">{error} <button type="button" onClick={()=>load()}>다시 불러오기</button></p>}
  {data?.enabled===false&&<div className="survival-empty"><p>시스템 계정 게시글 연동 준비 중입니다.</p></div>}
  {data?.enabled&&records.length===0&&<p>표시할 게시글이 없습니다.</p>}
  {records.length>0&&<ul>{records.map(record=><li key={record.id}>
   <time dateTime={record.createdAt}>{new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(record.createdAt))} KST</time>
   {record.warning?<details><summary>{record.warning}</summary><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{record.text}</p></details>:<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{record.text}</p>}
   <a href={record.url} target="_blank" rel="noopener noreferrer">마스토돈 원문{record.boosted?' · 부스트':''}</a>
  </li>)}</ul>}
  {preview&&onMore&&data?.enabled&&<button type="button" className="survival-card-link" onClick={onMore}>더보기 ›</button>}
  {!preview&&data?.enabled&&<div><button type="button" disabled={loading} onClick={()=>load()}>최신 게시글</button>{data.nextBefore&&<button type="button" disabled={loading} onClick={()=>load(data.nextBefore)}>이전 게시글</button>}</div>}
 </div>;
}
