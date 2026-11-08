let token=null; // Memory only: reload requires login.
export function setToken(value){token=value;}
export function apiUrl(path){
  const base=process.env.REACT_APP_API_BASE?.trim();
  if(!base && process.env.NODE_ENV==='production')throw Object.assign(new Error('API 주소가 설정되지 않았습니다. 배포 설정을 확인해 주세요.'),{code:'API_BASE_MISSING'});
  if(base && !/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(base))throw Object.assign(new Error('API 주소는 HTTPS 주소로 설정해야 합니다.'),{code:'API_BASE_INVALID'});
  return (base||'/api').replace(/\/$/,'')+path;
}
// Use /api through CRA in development; an absolute backend URL bypasses the proxy.
export async function api(path,{method='GET',body}={}) {
  const url=apiUrl(path), controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  let response,result;
  try {
    response=await fetch(url,{method,credentials:'include',signal:controller.signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    try{result=await response.json();}catch{
      if(controller.signal.aborted)throw new Error('timeout');
      throw Object.assign(new Error('API가 JSON 대신 다른 응답을 반환했습니다. 배포 API 주소를 확인해 주세요.'),{code:'API_RESPONSE_INVALID',status:response.status});
    }
  } catch(error) {
    if(error.code)throw error;
    throw Object.assign(new Error(controller.signal.aborted?'API 응답 시간이 초과되었습니다. 다시 시도해 주세요.':'API에 연결할 수 없습니다. 네트워크·API 주소·CORS 설정을 확인해 주세요.'),{code:controller.signal.aborted?'API_TIMEOUT':'API_CONNECTION_FAILED'});
  } finally {clearTimeout(timer);}
  if(!result || typeof result.ok!=='boolean')throw Object.assign(new Error('올바른 API 응답이 아닙니다.'),{code:'API_RESPONSE_INVALID',status:response.status});
  if(!response.ok||!result.ok){if(response.status===401)token=null;const error = new Error(result.error?.message||'요청 실패'); error.code = result.error?.code; error.status = response.status; error.requestId = result.requestId; throw error;}
  return result.data;
}
