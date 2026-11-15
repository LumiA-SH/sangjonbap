import {useEffect,useState} from 'react';
import {api} from '../api/client';

export default function AdminDashboard({onNavigate,onDenied}) {
 const [counts,setCounts]=useState(null),[logs,setLogs]=useState(null),[errors,setErrors]=useState([]),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let live=true;setCounts(null);setLogs(null);setErrors([]);
  const failed=e=>{if(!live)return;setErrors(old=>[...old,e.message]);if([401,403].includes(e.status))onDenied(e.message);};
  api('/admin/dashboard').then(r=>{if(live)setCounts(r.counts);}).catch(failed);
  api('/admin/action-logs').then(r=>{if(live)setLogs(r.records.slice(0,7));}).catch(failed);
  return()=>{live=false;};
 },[revision,onDenied]);
 const go=(id,label)=><button type="button" key={id} onClick={()=>onNavigate(id)}>{label} <span aria-hidden="true">→</span></button>;
 return <div className="admin-overview">
  <div className="admin-summary-stats" aria-label="운영 현황">
   {[['활성 아이템',counts?.items],['음식 / 활성 레시피',counts?`${counts.foods} / ${counts.recipes}`:null],['구역 / 조사 결과',counts?`${counts.areas} / ${counts.results}`:null],['활성 캐릭터',counts?.characters]].map(([label,value])=><section key={label}><small>{label}</small><strong>{value??'—'}</strong></section>)}
  </div>
  {errors.map((e,i)=><p role="alert" key={i}>{e}</p>)}
  <button type="button" onClick={()=>setRevision(v=>v+1)}>현황 새로고침</button>
  <section className="admin-overview-group"><h3>자주 쓰는 관리 메뉴</h3><div className="admin-quick-links">{[['characters','캐릭터 운영'],['items','아이템'],['foods','음식'],['recipes','레시피'],['area-hub','구역 관리'],['logs','전체 행동 로그']].map(([id,label])=>go(id,label))}</div></section>
  <section className="admin-overview-group"><h3>최근 행동 및 운영 로그</h3>{logs===null?<p>기록을 불러오는 중입니다. 조회 실패 시 위 오류를 확인하세요.</p>:logs.length===0?<p>표시할 기록이 없습니다.</p>:<ul className="admin-dashboard-logs">{logs.map(log=><li key={log.id}><div><small>{log.category} · {log.character_name||'운영 기록'}</small><p>{log.description}</p></div><time dateTime={log.created_at}>{new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(log.created_at))} KST</time></li>)}</ul>}{go('logs','전체 로그 확인')}</section>
  <section className="admin-overview-group"><h3>데이터 등록 흐름</h3><div className="admin-quick-links">{[['items','1. 아이템'],['foods','2. 음식'],['recipes','3. 레시피'],['area-hub','4. 구역 배치']].map(([id,label])=>go(id,label))}</div></section>
 </div>;
}
