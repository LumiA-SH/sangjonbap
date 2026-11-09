import {useRef,useState} from 'react';
import {api} from '../api/client';
import CharacterSearch from './CharacterSearch';
export default function CoinTransferPanel({character,busy,refresh}){
 const [target,setTarget]=useState(null),[quantity,setQuantity]=useState('1'),[confirmation,setConfirmation]=useState(null);
 const [pending,setPending]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');const sending=useRef(false);
 const blocked=busy||pending||!character||character.status==='DEAD'||character.in_active_battle;
 const amount=Number(quantity),valid=target&&String(target.id)!==String(character?.id)&&Number.isInteger(amount)&&amount>=1&&amount<=2147483647&&amount<=Number(character?.currency);
 async function send(){
  if(sending.current||blocked||!confirmation)return;
  sending.current=true;setPending(true);setError('');
  try{await api(`/characters/${confirmation.target.id}/coins`,{method:'POST',body:{quantity:confirmation.quantity,requestKey:confirmation.requestKey}});
   setMessage(`${confirmation.target.name}에게 코인 ${confirmation.quantity}개 양도 완료`);setConfirmation(null);
  }catch(e){setError(`${e.code||'TRANSFER_FAILED'}: ${e.message} · 응답을 확인하지 못했다면 같은 확인 내용으로 재시도하세요.`);}
  finally{try{await refresh();}catch{}sending.current=false;setPending(false);}
 }
 return <section aria-label="코인 양도"><h3>다른 캐릭터에게 코인 양도</h3>
  <CharacterSearch inputId="coin-target-search" label="코인 수령자 이름 검색" busy={blocked||!!confirmation} onSelect={(id,row)=>{setTarget(row);setMessage('');}}/>
  {target&&<p>수령자: {target.name} · ID {target.id}</p>}
  <label htmlFor="coin-quantity">코인 수량</label><input id="coin-quantity" type="number" min="1" step="1" value={quantity} disabled={blocked||!!confirmation} onChange={e=>setQuantity(e.target.value)}/>
  <p>보유 코인: {character?.currency??'-'}</p>
  <button disabled={blocked||!valid||!!confirmation} onClick={()=>{setError('');setConfirmation({target,quantity:amount,requestKey:crypto.randomUUID()});}}>코인 양도 확인</button>
  {confirmation&&<div role="group" aria-label="코인 양도 최종 확인"><p>{confirmation.target.name} (ID {confirmation.target.id})에게 코인 {confirmation.quantity}개를 보냅니다.</p>
   <button disabled={blocked} onClick={send}>코인 양도 확정</button><button disabled={pending} onClick={()=>setConfirmation(null)}>취소</button></div>}
  {pending&&<p role="status">양도 처리 중…</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </section>;
}
