import {useEffect,useState} from 'react';
import {api} from '../api/client';
import './public.css';
export const kst=value=>value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value))+' KST':'미정';
const states={UPCOMING:'예정',ONGOING:'진행 중',ENDED:'종료'};
export default function GuidePage({kind}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let live=true;setData(null);setError('');const load=()=>api('/public/guides/'+kind).then(r=>{if(live){setData(r);setError('');}}).catch(e=>{if(live){setData(null);setError(e.message);}});load();const timer=kind==='schedule'?setInterval(load,60000):null;return()=>{live=false;if(timer)clearInterval(timer);};},[kind,attempt]);
 return <section className="survival-card public-content"><h2>{{world:'세계관 안내',system:'시스템 안내',schedule:'러닝 일정'}[kind]}</h2>
 {error?<p role="alert">{error} <button onClick={()=>setAttempt(n=>n+1)}>다시 불러오기</button></p>:!data?<p role="status">안내를 불러오는 중…</p>:!data.content||(kind==='system'&&!data.content.items.length)?<p>현재 공개된 안내가 없습니다. 운영진의 등록을 기다려 주세요.</p>:<>
 {kind!=='system'&&<article><h3>{data.content.title}</h3><p className="public-prose">{data.content.body}</p>{kind==='schedule'&&<p>{kst(data.content.startAt)} ~ {kst(data.content.endAt)} · {states[data.content.state]}</p>}</article>}
 {data.content.items?.map(item=><article key={item.id}><h3>{item.title}</h3>{kind==='schedule'&&<p>{kst(item.startAt)} ~ {kst(item.endAt)} · {states[item.state]}</p>}<p className="public-prose">{item.body}</p></article>)}
 {kind==='schedule'&&<p>서버 확인 시각: {kst(data.serverNow)} · 상태는 1분마다 서버에서 다시 확인합니다.<button onClick={()=>setAttempt(n=>n+1)}>일정 새로고침</button></p>}
 </>}</section>;
}
