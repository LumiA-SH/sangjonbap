import {useEffect,useState} from 'react';
import {api} from '../api/client';
export default function NoticeFeed({preview=false,active=true,onMore}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let live=true;setData(null);setError('');if(active)api('/public/guides/notice').then(r=>{if(live)setData(r);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[active,attempt]);
 const items=data?.content?.items||[];
 return <div aria-label="공지사항 목록">{error?<p role="alert">{error} <button type="button" onClick={()=>setAttempt(v=>v+1)}>다시 불러오기</button></p>:!data?<p role="status">공지사항을 불러오는 중입니다.</p>:!items.length?<p>등록된 공지사항이 없습니다.</p>:<ul>{(preview?items.slice(0,3):items).map(item=><li key={item.id}><details open={!preview}><summary>{item.title}</summary><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.body}</p></details></li>)}</ul>}{preview&&onMore&&<button type="button" className="survival-card-link" onClick={onMore}>더보기 ›</button>}</div>;
}
