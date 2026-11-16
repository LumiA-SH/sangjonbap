import {useEffect,useState} from 'react';
import {subscribeApiPending} from './client';
import './RequestLoading.css';
export default function RequestLoading(){
  const [visible,setVisible]=useState(false);
  useEffect(()=>{let timer;const unsubscribe=subscribeApiPending(count=>{
    if(!count){clearTimeout(timer);timer=null;setVisible(false);}
    else if(!timer)timer=setTimeout(()=>setVisible(true),400);
  });return ()=>{unsubscribe();clearTimeout(timer);};},[]);
  return visible ? <div className="request-loading" role="status" aria-live="polite">서버 응답을 기다리고 있습니다…</div> : null;
}
