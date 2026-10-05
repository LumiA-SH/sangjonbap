let token=null; // Memory only: reload requires login.
export function setToken(value){token=value;}
// Use /api through CRA in development; an absolute backend URL bypasses the proxy.
export async function api(path,{method='GET',body}={}) {
  const response=await fetch((process.env.REACT_APP_API_BASE||'/api')+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let result;try{result=await response.json();}catch{throw new Error('API 응답을 읽을 수 없습니다. 서버 실행과 프록시 설정을 확인하세요.');}
  if(!response.ok||!result.ok){if(response.status===401)token=null;throw new Error(result.error?.message||'요청 실패');}
  return result.data;
}
