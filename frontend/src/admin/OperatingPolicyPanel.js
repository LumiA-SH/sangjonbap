import {useEffect, useState, useRef} from 'react';
import {api} from '../api/client';

const names = {
 anemia: '빈혈 RP 단계',
 donation: '직접 헌혈',
 announcements: '시스템 공지 정책',
 homepage: '홈페이지 공지·이벤트',
 recovery: '과거 데이터 복구 정책'
};

const labels = {
 enabled: '활성화',
 cost: '헌혈자 소비 혈량',
 recovery: '수혜자 회복 혈량',
 minimumRemaining: '헌혈 후 최소 혈량',
 maximum: '1회 최대 헌혈량',
 dailyLimitEnabled: '일일 횟수 제한 사용',
 dailyLimit: '일일 횟수',
 template: '게시 문구 ({character}, {provider}, {reward}, {quantity}, {rp}, {area}, {monster}, {clue}, {progress}, {event})',
 visibility: '공개 범위',
 deduplicate: '중복 게시 방지',
 retryEnabled: '실패 재시도',
 maxAttempts: '최대 시도 횟수',
 retryMinutes: '재시도 간격 (분)',
 thresholds: '조사율 기준 (쉼표로 구분)',
 accountId: '시스템 계정 ID',
 noticeTag: '공지 분류 태그',
 eventTag: '이벤트 분류 태그',
 limit: '노출 개수',
 publicOnly: '공개 게시물만',
 excludeReplies: '답글 제외',
 excludeBoosts: '부스트 제외',
 recipe: '레시피 최초 발견',
 gacha: '가챠 재고 전환',
 battle: '구형 전투 스냅샷',
 death: '캐릭터 사망',
 revive: '캐릭터 부활',
 area_unlock: '구역 해금',
 monster_discovery: '마물 최초 발견',
 clue_discovery: '중요 단서 최초 발견',
 investigation_progress: '조사율 달성',
 story: '스토리 이벤트',
 raid: '최종 레이드',
 failure_food: '실패 음식 섭취 RP'
};

const numbers = ['cost', 'recovery', 'minimumRemaining', 'maximum', 'dailyLimit', 'maxAttempts', 'retryMinutes', 'limit'];

export default function OperatingPolicyPanel({onDenied}) {
 const [kind, setKind] = useState('donation');
 const [draft, setDraft] = useState(null);
 const [before, setBefore] = useState(null);
 const [message, setMessage] = useState('');
 const [busy, setBusy] = useState(false);
 const saving = useRef(false);

 useEffect(() => {
  let live = true;

  setDraft(null);
  setMessage('조회 중…');

  api('/admin/policies/' + kind)
      .then(r => {
       if (live) {
        setDraft(r.settings);
        setBefore(r.settings);
        setMessage('');
       }
      })
      .catch(e => {
       if (live) {
        setMessage(e.message);
        if ([401, 403].includes(e.status)) onDenied(e.message);
       }
      });

  return () => {
   live = false;
  };
 }, [kind, onDenied]);

 async function save(e) {
  e.preventDefault();
  if (saving.current) return;
  if (!window.confirm('변경 전후를 확인하고 운영 정책을 저장합니까?')) return;

  saving.current = true;
  setBusy(true);

  try {
   const r = await api('/admin/policies/' + kind, {
    method: 'PATCH',
    body: {
     settings: draft,
     before,
     requestKey: crypto.randomUUID()
    }
   });

   setBefore(r.settings);
   setDraft(r.settings);
   setMessage('저장 완료 · 변경 이력이 기록되었습니다.');
  } catch (e) {
   setMessage(e.message);
   if ([401, 403].includes(e.status)) onDenied(e.message);
  } finally {
   saving.current = false;
   setBusy(false);
  }
 }

 function fields(values, change) {
  return Object.entries(values).map(([k, v]) => {
   let input;

   if (typeof v === 'boolean') {
    input = <input type="checkbox" checked={v} onChange={e => change(k, e.target.checked)}/>;
   } else if (k === 'visibility') {
    input = (
        <select value={v || ''} onChange={e => change(k, e.target.value || null)}>
         <option value="">미설정</option>
         {['public', 'unlisted', 'private'].map(x => <option key={x}>{x}</option>)}
        </select>
    );
   } else if (kind === 'recovery') {
    input = (
        <select value={v} onChange={e => change(k, e.target.value)}>
         <option>HOLD</option>
         <option>PREVIEW_ONLY</option>
        </select>
    );
   } else if (k === 'template') {
    input = <textarea value={v} maxLength={2000} onChange={e => change(k, e.target.value)}/>;
   } else if (k === 'thresholds') {
    input = <input value={v.join(',')} onChange={e => change(k, e.target.value ? e.target.value.split(',').map(Number) : [])}/>;
   } else {
    input = (
        <input type={numbers.includes(k) ? 'number' : 'text'} min={k === 'minimumRemaining' ? 0 : 1} max={['cost', 'recovery', 'minimumRemaining', 'maximum'].includes(k) ? 100 : undefined} value={v ?? ''} placeholder="미설정" onChange={e => change(k, e.target.value === '' ? null : numbers.includes(k) ? Number(e.target.value) : e.target.value)}/>
    );
   }

   return <label key={k}>{labels[k] || k}{input}</label>;
  });
 }

 function updateStage(index, key, value) {
  setDraft({
   ...draft,
   stages: draft.stages.map((s, i) => i === index ? {...s, [key]: value} : s)
  });
 }

 function renderAnemia() {
  return (
      <>
       <label>
        설정 활성화
        <input type="checkbox" checked={draft.enabled} onChange={e => setDraft({...draft, enabled: e.target.checked})}/>
       </label>

       {draft.stages.map((stage, index) => (
           <fieldset key={index}>
            <label>
             단계 명칭
             <input maxLength={50} required value={stage.name} onChange={e => updateStage(index, 'name', e.target.value)}/>
            </label>

            {['min', 'max', 'order'].map(k => (
                <label key={k}>
                 {{min: '최소 혈량', max: '최대 혈량', order: '표시 순서'}[k]}
                 <input type="number" required step="1" min={k === 'order' ? 0 : 1} max={k === 'order' ? 2147483647 : 100} value={stage[k] ?? ''} onChange={e => updateStage(index, k, e.target.value === '' ? null : Number(e.target.value))}/>
                </label>
            ))}

            <button type="button" onClick={() => setDraft({...draft, stages: draft.stages.filter((_, i) => i !== index)})}>단계 제거</button>
           </fieldset>
       ))}

       <button type="button" disabled={draft.stages.length >= 100} onClick={() => setDraft({...draft, stages: [...draft.stages, {name: '', min: null, max: null, order: draft.stages.length}]})}>단계 추가</button>
       <p>표시 순서: {[...draft.stages].sort((a, b) => a.order - b.order).map(s => s.name).join(' → ')}</p>
      </>
  );
 }

 function renderAnnouncements() {
  return Object.entries(draft.events).map(([name, event]) => (
      <fieldset key={name}>
       <legend>{name === 'gacha' ? '가챠 결과' : labels[name]}</legend>
       {fields(event, (k, v) => setDraft({
        ...draft,
        events: {...draft.events, [name]: {...event, [k]: v}}
       }))}
      </fieldset>
  ));
 }

 function getDescription() {
  if (kind === 'anemia') return '표시 전용입니다. 활성화 시 혈량 1~100을 빠짐없이 한 번씩 포함해야 합니다. 혈량 0과 사망 상태는 변경할 수 없습니다.';
  if (kind === 'donation') return '미확정 수치는 비워 두세요. 활성화하려면 필수 수치를 모두 설정해야 합니다. 1회 고정 소비·회복량이며 최대 헌혈량 이내로 제한합니다.';
  if (kind === 'recovery') return '조회·미리보기 정책만 저장합니다. 복구 실행 및 과거 데이터 변경은 차단됩니다.';
  return '연동 준비용 정책입니다. 저장해도 실제 게시·수집은 실행되지 않으며 기존 홈페이지 안내를 유지합니다. 게시 실패 기록·재시도 실행은 연동 단계에서 구현합니다.';
 }

 return (
     <section>
      <h2>운영 정책</h2>

      <nav aria-label="운영 정책 종류">
       {Object.entries(names).map(([k, n]) => (
           <button disabled={busy} key={k} aria-pressed={kind === k} onClick={() => {setDraft(null); setKind(k);}}>{n}</button>
       ))}
      </nav>

      <p>{getDescription()}</p>

      {draft && (
          <form className="admin-form" onSubmit={save}>
           <fieldset disabled={busy}>
            <legend>{names[kind]}</legend>

            {kind === 'anemia' ? renderAnemia() : kind === 'announcements' ? renderAnnouncements() : fields(draft, (k, v) => setDraft({...draft, [k]: v}))}
           </fieldset>

           <details>
            <summary>변경 전후 확인</summary>
            <pre>{JSON.stringify({before, after: draft}, null, 2)}</pre>
           </details>

           <button disabled={busy}>설정 저장</button>
          </form>
      )}

      <p role="status">{message}</p>
     </section>
 );
}