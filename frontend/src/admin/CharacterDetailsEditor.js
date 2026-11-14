import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import RecipePicker from './RecipePicker';

const fields = [
 'hunter_grade',
 'has_ability',
 'ability_grade',
 'recipe_ids',
 'daily_meal_count',
 'daily_training_done',
 'death_count',
 'revive_count'
];

const countLabels = {
 daily_meal_count: '오늘 식사 횟수',
 death_count: '누적 사망 횟수',
 revive_count: '누적 부활 횟수'
};

export default function CharacterDetailsEditor({id, onDenied, onSaved}) {
 const [loaded, setLoaded] = useState(null);
 const [draft, setDraft] = useState(null);
 const [recipe, setRecipe] = useState('');
 const [reason, setReason] = useState('');
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState('');

 const pending = useRef(false);
 const generation = useRef(0);

 async function load() {
  const token = ++generation.current;
  const r = await api('/admin/characters/' + id + '/details');

  if (token === generation.current) {
   setLoaded(r);
   setDraft(Object.fromEntries(fields.map(k => [k, r.record[k]])));
   setReason('');
  }
 }

 async function work(f) {
  if (pending.current) return;

  pending.current = true;
  setBusy(true);
  setMessage('');

  try {
   await f();
  } catch (e) {
   setMessage(`${e.code || 'ERROR'}: ${e.message}`);
   if ([401, 403].includes(e.status)) onDenied?.(e.message);
  } finally {
   pending.current = false;
   setBusy(false);
  }
 }

 useEffect(() => {
  work(load);

  return () => {
   generation.current++;
  };
 }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

 async function save(e) {
  e.preventDefault();

  await work(async () => {
   if (!window.confirm('변경 전후와 사유를 확인했습니다. 캐릭터 설정을 저장합니까?')) return;

   const r = await api('/admin/characters/' + id + '/details', {
    method: 'PATCH',
    body: {
     ...draft,
     reason,
     expectedVersion: loaded.version,
     requestKey: crypto.randomUUID()
    }
   });

   setLoaded(r);
   setDraft(Object.fromEntries(fields.map(k => [k, r.record[k]])));
   setMessage('상세 설정 저장 성공');

   await onSaved?.();
  });
 }

 return (
     <section>
      <h3>등급·학습·일일 상태·누적 횟수</h3>
      <button type="button" disabled={busy} onClick={() => work(load)}>상세 설정 다시 조회</button>
      <p>상태·HP·혈량과 최초 발견 기록은 변경하지 않습니다. 횟수 정정은 과거 이력을 재작성하지 않으며, 자정 복구의 생사 이력 확인이 보수적으로 보류될 수 있습니다.</p>

      {draft && (
          <form className="admin-form" onSubmit={save}>
           <label>
            헌터 등급
            <select value={draft.hunter_grade} disabled={busy} onChange={e => setDraft({...draft, hunter_grade: e.target.value})}>
             {['B', 'A', 'S'].map(g => <option key={g}>{g}</option>)}
            </select>
           </label>

           <label>
            이능 보유
            <input type="checkbox" checked={draft.has_ability} disabled={busy} onChange={e => setDraft({...draft, has_ability: e.target.checked, ability_grade: e.target.checked ? 'E' : null})}/>
           </label>

           <label>
            이능 등급
            <select value={draft.ability_grade || ''} disabled={busy || !draft.has_ability} onChange={e => setDraft({...draft, ability_grade: e.target.value})}>
             <option value="">없음</option>
             {['E', 'D', 'C', 'B', 'A', 'S'].map(g => <option key={g}>{g}</option>)}
            </select>
           </label>

           {['daily_meal_count', 'death_count', 'revive_count'].map(k => (
               <label key={k}>
                {countLabels[k]}
                <input required type="number" min="0" max={k === 'daily_meal_count' ? 5 : 2147483647} step="1" disabled={busy} value={draft[k]} onChange={e => setDraft({...draft, [k]: e.target.value === '' ? '' : Number(e.target.value)})}/>
               </label>
           ))}

           <label>
            오늘 훈련 완료
            <input type="checkbox" disabled={busy} checked={draft.daily_training_done} onChange={e => setDraft({...draft, daily_training_done: e.target.checked})}/>
           </label>

           <div className="admin-wide">
            <h4>학습 레시피</h4>
            <ul>
             {draft.recipe_ids.map(r => (
                 <li key={r}>
                  레시피 ID {r}
                  <button type="button" disabled={busy} onClick={() => setDraft({...draft, recipe_ids: draft.recipe_ids.filter(v => v !== r)})}>학습 해제</button>
                 </li>
             ))}
            </ul>

            <RecipePicker required={false} label="학습 추가 레시피" value={recipe} onChange={setRecipe} disabled={busy} onDenied={onDenied}/>
            <button type="button" disabled={busy || !recipe || draft.recipe_ids.includes(recipe)} onClick={() => setDraft({...draft, recipe_ids: [...draft.recipe_ids, recipe]})}>학습 추가</button>
            <p>이미 최초 발견된 레시피만 새로 학습시킬 수 있습니다. 발견 이력·보상·상점 등록은 변경하지 않습니다.</p>
           </div>

           <label>
            수정 사유
            <input required maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)}/>
           </label>

           <details className="admin-wide">
            <summary>변경 전후 비교</summary>
            <pre>{JSON.stringify({before: loaded.record, after: draft}, null, 2)}</pre>
           </details>

           <button disabled={busy || !reason.trim()}>상세 설정 저장</button>
          </form>
      )}

      <p role="status">{busy ? '처리 중…' : message}</p>
     </section>
 );
}