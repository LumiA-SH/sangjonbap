import {api} from '../api/client';

// A public, opaque invalidation signal only. Post bodies still require the game session.
export function subscribeSystemFeed({onChange,onError,Socket=WebSocket}){
 let stopped=false,connecting=false,socket=null,retry=null,heartbeat=null,deadline=null,config=null,attempt=0,ref=0,awaitingHeartbeat=null;
 const topic='realtime:system-feed-signal';
 const clear=()=>{clearTimeout(deadline);clearInterval(heartbeat);deadline=null;heartbeat=null;};
 function disconnect(){clear();const old=socket;socket=null;if(old){old.onclose=null;old.onerror=null;old.onmessage=null;old.onopen=null;old.close();}}
 function reconnect(){
  disconnect();if(stopped||document.visibilityState==='hidden'||retry)return;
  onError(new Error('실시간 연결을 복구하고 있습니다.'));
  retry=setTimeout(()=>{retry=null;connect();},Math.min(30000,1000*2**Math.min(attempt++,5)));
 }
 async function connect(){
  if(stopped||socket||connecting||document.visibilityState==='hidden')return;
  connecting=true;
  try{
   if(!config)config=await api('/public/system-feed/connection',{background:true});
   if(stopped||socket||document.visibilityState==='hidden')return;
   if(config.url!=='wss://grkohfxvafbquhmgnvwj.supabase.co/realtime/v1/websocket'||config.table!=='system_feed_signal')throw Error('실시간 연결 설정을 확인하세요.');
   const ws=new Socket(config.url+'?apikey='+encodeURIComponent(config.key)+'&vsn=1.0.0');socket=ws;
   const send=(event,payload={},target=topic)=>{const id=String(++ref);ws.send(JSON.stringify({topic:target,event,payload,ref:id}));return id;};
   let joinRef;
   deadline=setTimeout(reconnect,10000);
   ws.onopen=()=>{joinRef=send('phx_join',{config:{broadcast:{ack:false,self:false},presence:{enabled:false},postgres_changes:[{event:'UPDATE',schema:'public',table:config.table}],private:false},access_token:config.key});};
   ws.onmessage=event=>{
    if(socket!==ws)return;
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message.event==='phx_reply'&&message.ref===awaitingHeartbeat){awaitingHeartbeat=null;return;}
    if(message.event==='phx_reply'&&message.ref===joinRef){
     if(message.payload?.status!=='ok'){reconnect();return;}
     clearTimeout(deadline);attempt=0;awaitingHeartbeat=null;
     heartbeat=setInterval(()=>{if(awaitingHeartbeat){reconnect();return;}awaitingHeartbeat=send('heartbeat',{},'phoenix');},25000);
     onChange();return;
    }
    if(message.event==='postgres_changes'&&message.topic===topic&&message.payload?.data?.table===config.table&&message.payload.data.type==='UPDATE')onChange();
    if(message.event==='system'&&message.payload?.status==='ok')onChange();
    if(message.event==='phx_error'||message.event==='phx_close'||(message.event==='system'&&message.payload?.status==='error'))reconnect();
   };
   ws.onerror=reconnect;ws.onclose=reconnect;
  }catch(error){if(stopped)return;onError(error);if(error.status!==401&&error.status!==403)reconnect();}finally{connecting=false;}
 }
 const resume=()=>{if(document.visibilityState==='hidden'){clearTimeout(retry);retry=null;disconnect();}else connect();};
 document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);connect();
 return()=>{stopped=true;clearTimeout(retry);disconnect();document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);};
}
