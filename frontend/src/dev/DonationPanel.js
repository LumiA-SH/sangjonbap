import {useRef,useState} from 'react';
import {api} from '../api/client';
import CharacterSearch from './CharacterSearch';
export default function DonationPanel({character,busy,refresh}){
 const [target,setTarget]=useState(null),[preview,setPreview]=useState(null),[message,setMessage]=useState(''),[pending,setPending]=useState(false);
 const key=useRef(null),working=useRef(false);
 async function check(){if(working.current)return;working.current=true;setPending(true);try{const r=await api(`/characters/${target}/donation-preview`);setPreview(r);key.current=crypto.randomUUID();setMessage('');}catch(e){setMessage(e.message);}finally{working.current=false;setPending(false);}}
 async function confirm(){if(working.current)return;working.current=true;setPending(true);try{const r=await api(`/characters/${target}/donate`,{method:'POST',body:{expected:preview,requestKey:key.current}});setPreview(null);setMessage(`헌혈 완료: 혈량 ${r.cost} 소비, ${r.targetName} 혈량 ${r.recovery} 회복`);await refresh();}catch(e){setMessage(e.message);if(!['API_TIMEOUT','API_CONNECTION_FAILED'].includes(e.code))setPreview(null);}finally{working.current=false;setPending(false);}}
 const disabled=busy||pending||!character||character.status!=='ALIVE'||(character.in_active_battle||character.in_battle);
 return <section className="dev-panel"><h3>직접 헌혈</h3><CharacterSearch label="헌혈 대상 이름 검색" inputId="donation-search" busy={disabled} onSelect={id=>{setTarget(id);setPreview(null);}}/>
 <button disabled={disabled||!target} onClick={check}>헌혈 조건 확인</button>
 {preview&&<div role="dialog" aria-label="직접 헌혈 최종 확인"><p>{preview.targetName} (ID {preview.targetId})에게 헌혈합니다. 내 혈량 {preview.cost} 소비 / 대상 혈량 {preview.recovery} 회복</p><button disabled={disabled} onClick={confirm}>확인 후 헌혈</button><button disabled={pending} onClick={()=>setPreview(null)}>취소</button></div>}<p role="status">{message}</p></section>;
}
