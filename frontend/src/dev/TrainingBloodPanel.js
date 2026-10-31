import {useRef,useState} from 'react';
import {api} from '../api/client';

export default function TrainingBloodPanel({character,inventory,busy,run,refresh}) {
  const [itemId,setItemId]=useState(''),[target,setTarget]=useState(''),[message,setMessage]=useState('');
  const sending=useRef(false);
  const packs=inventory.filter(i=>i.effect_type==='BLOOD_PACK');
  const selected=packs.find(i=>String(i.item_id)===itemId);
  async function perform(path,body={}) {
    if(busy||sending.current)return;sending.current=true;
    try{await run(async()=>{
      setMessage('');
      let result;
      try{result=await api(path,{method:'POST',body:{...body,requestKey:crypto.randomUUID()}});}
      catch(e){setMessage(`${e.code}: ${e.message}`);return;}
      setMessage(`성공: ${JSON.stringify(result)}`);
      try{if(!await refresh())setMessage(m=>m+' · 일부 상태 재조회 실패');}catch{setMessage(m=>m+' · 상태 재조회 실패');}
    });}finally{sending.current=false;}
  }
  return <section><h2>일일훈련·혈액팩</h2>
    <p>훈련: KST 하루 1회, AP 0, 재화 +1. 빈사·사망 상태에서는 불가합니다.</p>
    <button disabled={busy||character?.status!=='ALIVE'} onClick={()=>perform('/training')}>일일훈련</button>
    <label>보유 혈액팩<select value={itemId} disabled={busy} onChange={e=>setItemId(e.target.value)}><option value="">선택</option>{packs.map(i=><option key={i.item_id} value={i.item_id}>{i.name} ({i.quantity}개)</option>)}</select></label>
    <button disabled={busy||!selected||!character||character.status==='DEAD'} onClick={()=>perform(`/inventory/blood-packs/${itemId}/use`)}>혈액팩 사용</button>
    <label>양도 대상 캐릭터 ID<input value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}/></label>
    <button disabled={busy||!selected||character?.status!=='ALIVE'||! /^[1-9][0-9]{0,18}$/.test(target)} onClick={()=>perform(`/inventory/blood-packs/${itemId}/transfer`,{targetId:target,quantity:1})}>혈액팩 1개 양도</button>
    <p role="status">{message}</p>
  </section>;
}
