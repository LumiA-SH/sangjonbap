import {useState} from 'react';
import {api} from '../api/client';

export default function DiagnosticsPanel({onDenied}) {
 const [data, setData] = useState(null);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');

 async function load() {
  setBusy(true);
  setError('');

  try {
   setData(await api('/admin/diagnostics'));
  } catch (e) {
   setError(e.message);
   if ([401, 403].includes(e.status)) onDenied(e.message);
  } finally {
   setBusy(false);
  }
 }

 return (
     <section>
      <h2>기존 데이터 진단</h2>
      <p>분류별 최대 100건 조회입니다. 이력 전환·복구·삭제는 실행하지 않습니다. 복구 시 대상과 변경 전후·관련 보상을 검토하고 별도 승인해야 합니다. 성공·실패 결과로 공유된 아이템은 실패 음식 효과(0)가 우선합니다.</p>

      <button disabled={busy} onClick={load}>{busy ? '조회 중…' : '진단 조회'}</button>
      <p role="alert">{error}</p>

      {data && Object.entries({
       recipes: '발견 이력이 없는 습득 레시피',
       gachas: '재고 미확정 보상',
       battles: '전투 상태 불일치·스냅샷 누락',
       sharedFailureItems: '성공·실패 공유 아이템'
      }).map(([key, label]) => (
          <details key={key} open>
           <summary>{label}</summary>
           <pre>{JSON.stringify(data[key], null, 2)}</pre>
          </details>
      ))}
     </section>
 );
}