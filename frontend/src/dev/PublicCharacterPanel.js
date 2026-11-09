import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';
import CharacterSearch from './CharacterSearch';
export default function PublicCharacterPanel({targetId}){
 const [data,setData]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState('');const current=useRef(null);
 async function load(id){const token={};current.current=token;setData(null);setError('');setPending(true);
  try{const result=await api(`/characters/${id}/public`);if(current.current===token)setData(result);}
  catch(e){if(current.current===token)setError(`${e.code||'CHARACTER_READ_FAILED'}: ${e.message}`);}
  finally{if(current.current===token)setPending(false);}
 }
 useEffect(()=>{if(targetId)load(targetId);return()=>{current.current=null;};},[targetId]); // eslint-disable-line react-hooks/exhaustive-deps
 return <section aria-label="다른 캐릭터 정보"><h3>다른 캐릭터 상태·소지품</h3>
  {!targetId&&<CharacterSearch inputId="public-character-search" label="조회할 캐릭터 이름 검색" busy={pending} onSelect={load}/>}
  {pending&&<p role="status">조회 중…</p>}{error&&<p role="alert">{error}</p>}
  {data&&<><h4>{data.character.name}</h4><p>상태: {data.character.status}{data.character.in_active_battle?' · 전투 중':''}</p><dl>{[['HP','hp','max_hp'],['혈량','blood','max_blood'],['AP','ap','max_ap'],['ATK','atk'],['DEF','def'],['AGI','agi']].map(([name,key,max])=><div key={key}><dt>{name}</dt><dd>{data.character[key]}{max?` / ${data.character[max]}`:''}</dd></div>)}</dl>
   <h4>소지품</h4>{data.inventory.length?<ul>{data.inventory.map(i=><li key={i.itemId}>{i.name} × {i.quantity}</li>)}</ul>:<p>소지품이 없습니다.</p>}
   <p>공개 정보 조회 전용입니다. 다른 캐릭터의 데이터는 수정할 수 없습니다.</p></>}
 </section>;
}
