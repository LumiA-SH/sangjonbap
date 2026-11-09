import {useRef,useState} from 'react';
import {api} from '../api/client';
export default function InitialCharacterSettings({character,onSaved,onDenied}) {
 const [draft,setDraft]=useState({hunter_grade:'',has_ability:'',ability_grade:'',atk:'',def:'',agi:''});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const pending=useRef(false);
 const change=(key,value)=>setDraft(d=>({...d,[key]:value}));
 async function save(e){e.preventDefault();if(pending.current)return;
  const body={hunter_grade:draft.hunter_grade,has_ability:draft.has_ability==='yes',ability_grade:draft.has_ability==='yes'?draft.ability_grade:null,
   atk:Number(draft.atk),def:Number(draft.def),agi:Number(draft.agi),expectedUpdatedAt:character.updated_at,requestKey:crypto.randomUUID()};
  if(!window.confirm(character.name+' 초기 설정: 미설정 → '+body.hunter_grade+' / ATK '+body.atk+' · DEF '+body.def+' · AGI '+body.agi+' / 이능 '+(body.has_ability?body.ability_grade:'없음')+'으로 저장합니까?'))return;
  pending.current=true;setBusy(true);setError('');
  try{await api('/admin/characters/'+character.id+'/initial-settings',{method:'PATCH',body});await onSaved();}
  catch(e){setError(e.message);if([401,403].includes(e.status))onDenied(e.message);}
  finally{pending.current=false;setBusy(false);}
 }
 return <section><h3>게임 초기 능력치 설정</h3><p>캐릭터 계정은 연결되었습니다. 등급과 능력치를 설정하세요. B 합계 36 · A 40 · S 45, 각각 8~40입니다. 기존 자원과 기록은 유지합니다.</p>
 <form className="admin-form" onSubmit={save}>
 <label>헌터 등급<select required value={draft.hunter_grade} disabled={busy} onChange={e=>change('hunter_grade',e.target.value)}><option value="">선택</option>{['B','A','S'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>이능 보유<select required value={draft.has_ability} disabled={busy} onChange={e=>change('has_ability',e.target.value)}><option value="">선택</option><option value="no">없음</option><option value="yes">있음</option></select></label>
 {draft.has_ability==='yes'&&<label>이능 등급<select required value={draft.ability_grade} disabled={busy} onChange={e=>change('ability_grade',e.target.value)}><option value="">선택</option>{['E','D','C','B','A','S'].map(x=><option key={x}>{x}</option>)}</select></label>}
 {['atk','def','agi'].map(k=><label key={k}>{k.toUpperCase()}<input required type="number" min="8" max="40" step="1" value={draft[k]} disabled={busy} onChange={e=>change(k,e.target.value)}/></label>)}
 <button disabled={busy}>{busy?'저장 중…':'초기 설정 저장'}</button></form><p role="alert">{error}</p></section>;
}
