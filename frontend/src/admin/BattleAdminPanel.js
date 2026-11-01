import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';
import ItemPicker from './ItemPicker';

const emptyMonster=()=>({name:'',description:'',image_url:'',max_hp:1,atk:0,def:0,agi:0,is_active:false,areas:[],drops:[],
  actions:[{name:'일반공격',action_type:'ATTACK',probability:100,multiplier:1,is_active:true,sort_order:0}]});
const fields=['name','description','image_url','max_hp','atk','def','agi','is_active'];
const cleanMonster=m=>({...Object.fromEntries(fields.map(k=>[k,m[k]])),
  areas:m.areas.map(a=>({area_id:String(a.area_id),weight:a.weight})),
  actions:m.actions.map(a=>({name:a.name,action_type:a.action_type,probability:Number(a.probability),multiplier:Number(a.multiplier),is_active:a.is_active,sort_order:a.sort_order,
    condition_type:a.condition_type??null,condition_value:a.condition_value??null})),
  drops:m.drops.map(d=>({item_id:String(d.item_id),drop_rate:Number(d.drop_rate),min_quantity:d.min_quantity,max_quantity:d.max_quantity,is_ingredient:d.is_ingredient}))});

export default function BattleAdminPanel({onDenied}) {
  const [rows,setRows]=useState([]),[areas,setAreas]=useState([]),[draft,setDraft]=useState(emptyMonster),[id,setId]=useState(null);
  const [settings,setSettings]=useState(null),[users,setUsers]=useState([]),[account,setAccount]=useState(null);
  const [profile,setProfile]=useState({name:'',hunter_grade:'',atk:10,def:10,agi:10,has_ability:false,ability_grade:null});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const pending=useRef(false);
  async function work(fn) {
    if(pending.current)return;pending.current=true;setBusy(true);setMessage('');
    try{await fn();}catch(e){setMessage(`${e.code||'ERROR'}: ${e.message}`);if([401,403].includes(e.status))onDenied(e.message);}
    finally{pending.current=false;setBusy(false);}
  }
  async function reload() {
    const [m,a,s,u]=await Promise.all([api('/admin/monsters'),api('/admin/battle-areas'),api('/admin/battle-abilities'),api('/admin/users')]);
    setRows(m.records);setAreas(a.records);setSettings(s.settings);setUsers(u.records);
  }
  useEffect(()=>{work(reload);},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const change=(key,value)=>setDraft(d=>({...d,[key]:value}));
  const rowChange=(kind,index,key,value)=>setDraft(d=>({...d,[kind]:d[kind].map((r,i)=>i===index?{...r,[key]:value}:r)}));
  const remove=(kind,index)=>setDraft(d=>({...d,[kind]:d[kind].filter((_,i)=>i!==index)}));
  const number=(label,value,onChange)=><label>{label}<input type="number" min="0" step="any" required value={value} disabled={busy} onChange={e=>onChange(e.target.value===''?'':Number(e.target.value))}/></label>;
  async function saveMonster(e) {
    e.preventDefault();await work(async()=>{
      const sum=draft.actions.filter(a=>a.is_active).reduce((n,a)=>n+Number(a.probability),0);
      if(Math.abs(sum-100)>0.000001)throw Error('활성 행동 확률 합계는 100%여야 합니다.');
      const saved=await api(`/admin/monsters${id?`/${id}`:''}`,{method:id?'PATCH':'POST',body:{...draft,requestKey:crypto.randomUUID()}});
      const fresh=await api(`/admin/monsters/${saved.record.id}`);setId(fresh.record.id);setDraft(cleanMonster(fresh.record));await reload();setMessage('마물 저장 성공');
    });
  }
  return <section><h2>일반 PVE 운영 설정</h2><p role="alert">{message}</p>
    <button disabled={busy} onClick={()=>work(reload)}>새로고침</button>
    <details open><summary>마물 등록·수정</summary>
      <button disabled={busy} onClick={()=>{setId(null);setDraft(emptyMonster());}}>새 마물</button>
      <ul>{rows.map(r=><li key={r.id}>{r.name} · ID {r.id}<button disabled={busy} onClick={()=>work(async()=>{
        const data=await api(`/admin/monsters/${r.id}`);setId(r.id);setDraft(cleanMonster(data.record));
      })}>상세/수정</button></li>)}</ul>
      <form className="admin-form" onSubmit={saveMonster}>
        <h3>{id?`마물 ${id} 수정`:'신규 마물'}</h3>
        {['name','description','image_url'].map(k=><label key={k}>{{name:'이름',description:'설명',image_url:'이미지 URL'}[k]}<input value={draft[k]??''} required={k==='name'} disabled={busy} onChange={e=>change(k,e.target.value)}/></label>)}
        {['max_hp','atk','def','agi'].map(k=><div key={k}>{number(k,draft[k],v=>change(k,v))}</div>)}
        <label>활성<input type="checkbox" checked={draft.is_active} disabled={busy} onChange={e=>change('is_active',e.target.checked)}/></label>
        <h3>출현 지역</h3>{draft.areas.map((a,i)=><fieldset key={i}><label>지역<select value={a.area_id} disabled={busy} onChange={e=>rowChange('areas',i,'area_id',e.target.value)} required>
          <option value="">지역 선택</option>{areas.map(r=><option key={r.id} value={r.id}>{r.name} · ID {r.id}</option>)}</select></label>
          {number('출현 가중치',a.weight,v=>rowChange('areas',i,'weight',v))}<button type="button" disabled={busy} onClick={()=>remove('areas',i)}>지역 제거</button></fieldset>)}
        <button type="button" disabled={busy} onClick={()=>change('areas',[...draft.areas,{area_id:'',weight:1}])}>지역 추가</button>
        <h3>마물 행동</h3>{draft.actions.map((a,i)=><fieldset key={i}>
          <label>행동명<input value={a.name} required disabled={busy} onChange={e=>rowChange('actions',i,'name',e.target.value)}/></label>
          <label>행동 종류<select value={a.action_type} disabled={busy} onChange={e=>rowChange('actions',i,'action_type',e.target.value)}>{['ATTACK','SPECIAL_ATTACK','FLEE'].map(v=><option key={v}>{v}</option>)}</select></label>
          {number('확률 %',a.probability,v=>rowChange('actions',i,'probability',v))}{number('공격 배율',a.multiplier,v=>rowChange('actions',i,'multiplier',v))}
          <label>사용<input type="checkbox" checked={a.is_active} disabled={busy} onChange={e=>rowChange('actions',i,'is_active',e.target.checked)}/></label>
          {a.condition_type&&<p>조건부 행동 {a.condition_type}: 수정 HOLD</p>}
          <button type="button" disabled={busy} onClick={()=>remove('actions',i)}>행동 제거</button></fieldset>)}
        <button type="button" disabled={busy} onClick={()=>change('actions',[...draft.actions,{name:'',action_type:'ATTACK',probability:0,multiplier:1,is_active:true,sort_order:draft.actions.length}])}>행동 추가</button>
        <p>활성 확률 합계: {draft.actions.filter(a=>a.is_active).reduce((n,a)=>n+Number(a.probability),0)}%</p>
        <h3>드롭</h3>{draft.drops.map((d,i)=><fieldset key={i}>
          <ItemPicker label="드롭 아이템" value={d.item_id} disabled={busy} onDenied={onDenied} onChange={v=>rowChange('drops',i,'item_id',v)}/>
          {number('드롭 확률 %',d.drop_rate,v=>rowChange('drops',i,'drop_rate',v))}{number('최소 수량',d.min_quantity,v=>rowChange('drops',i,'min_quantity',v))}{number('최대 수량',d.max_quantity,v=>rowChange('drops',i,'max_quantity',v))}
          <label>식재료<input type="checkbox" checked={d.is_ingredient} disabled={busy} onChange={e=>rowChange('drops',i,'is_ingredient',e.target.checked)}/></label>
          <button type="button" disabled={busy} onClick={()=>remove('drops',i)}>드롭 제거</button></fieldset>)}
        <button type="button" disabled={busy} onClick={()=>change('drops',[...draft.drops,{item_id:'',drop_rate:100,min_quantity:1,max_quantity:1,is_ingredient:false}])}>드롭 추가</button>
        <button disabled={busy}>마물 저장</button>
      </form>
    </details>
    <details><summary>이능관리등급 배율·AP 비용</summary>{settings&&<form className="admin-form" onSubmit={e=>{e.preventDefault();work(async()=>{
      await api('/admin/battle-abilities',{method:'PATCH',body:{settings,requestKey:crypto.randomUUID()}});await reload();setMessage('이능 설정 저장 성공');
    });}}>{Object.entries(settings).map(([k,v])=><div key={k}>{number(k,v,value=>setSettings(s=>({...s,[k]:value})))}</div>)}<button disabled={busy}>이능 설정 저장</button></form>}</details>
    <details><summary>승인 캐릭터 등록 및 OAuth 계정 연결</summary>
      <p>합격자만 등록하세요. 대상은 실제 OAuth로 검증된 계정이어야 하며 계정 역할은 바뀌지 않습니다.</p>
      <ul>{users.filter(u=>!u.character_id&&u.is_active).map(u=><li key={u.id}>계정 ID {u.id}<button disabled={busy} onClick={()=>work(async()=>{
        const r=await api(`/admin/users/${u.id}/verified-account`);setAccount(r.record);
      })}>인증 정보 확인</button></li>)}</ul>
      {account&&<form className="admin-form" onSubmit={e=>{e.preventDefault();work(async()=>{
        if(!window.confirm(`검증된 계정 ${account.id}에 심사 확정 캐릭터를 등록합니까?`))return;
        await api(`/admin/users/${account.id}/character`,{method:'POST',body:{...profile,instance:account.mastodon_instance,accountId:account.mastodon_account_id,requestKey:crypto.randomUUID()}});
        setAccount(null);await reload();setMessage('캐릭터 등록 완료');
      });}}>
        <p>{account.mastodon_instance} · 외부 ID {account.mastodon_account_id} · OAuth {account.oauth_verified_at||'미검증'}</p>
        <label>캐릭터 이름<input required maxLength={40} value={profile.name} disabled={busy} onChange={e=>setProfile({...profile,name:e.target.value})}/></label>
        <label>운영진 확정 등급<select required disabled={busy} value={profile.hunter_grade} onChange={e=>setProfile({...profile,hunter_grade:e.target.value})}><option value="">선택</option>{['B','A','S'].map(g=><option key={g}>{g}</option>)}</select></label>
        {['atk','def','agi'].map(k=><div key={k}>{number(k,profile[k],v=>setProfile({...profile,[k]:v}))}</div>)}
        <p>개별 8~40 · 합계 {Number(profile.atk)+Number(profile.def)+Number(profile.agi)} / B36·A40·S45</p>
        <label>이능관리등급<select disabled={busy} value={profile.ability_grade||''} onChange={e=>setProfile({...profile,has_ability:!!e.target.value,ability_grade:e.target.value||null})}><option value="">이능 없음</option>{['E','D','C','B','A','S'].map(g=><option key={g}>{g}</option>)}</select></label>
        <button disabled={busy||!account.oauth_verified_at||!!account.character_id}>승인 캐릭터 등록</button>
      </form>}
    </details>
  </section>;
}
