let token=null; // Memory only: reload requires login.
export function setToken(value){token=value;}
export function apiUrl(path){return (process.env.REACT_APP_API_BASE||'/api').replace(/\/$/,'')+path;}
// Use /api through CRA in development; an absolute backend URL bypasses the proxy.
export async function api(path,{method='GET',body}={}) {
  const response=await fetch(apiUrl(path),{method,credentials:'include',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let result;try{result=await response.json();}catch{throw new Error('API 응답을 읽을 수 없습니다. 서버 실행과 프록시 설정을 확인하세요.');}
  if(!response.ok||!result.ok){if(response.status===401)token=null;const error = new Error(result.error?.message||'요청 실패'); error.code = result.error?.code; error.status = response.status; error.requestId = result.requestId; throw error;}
  return result.data;
}
