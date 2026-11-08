import {useEffect,useState} from 'react';

const messages={
  OAUTH_STATE_INVALID:'로그인 요청이 만료되었거나 브라우저 정보가 일치하지 않습니다. 이 브라우저에서 새로 로그인해 주세요.',
  OAUTH_DENIED:'Mastodon 로그인이 취소되었습니다. 원하시면 다시 로그인해 주세요.',
  OAUTH_CODE_INVALID:'로그인 응답을 확인할 수 없습니다. 새로 로그인해 주세요.',
  OAUTH_EXCHANGE_FAILED:'Mastodon 인증 서버를 확인하지 못했습니다. 잠시 후 다시 로그인해 주세요.',
  USER_UNAVAILABLE:'이 계정으로 로그인할 수 없습니다. 운영진에게 문의해 주세요.',
  OAUTH_IDENTITY_CONFLICT:'계정 연결 확인이 필요합니다. 운영진에게 문의해 주세요.',
  OAUTH_LOGIN_FAILED:'로그인을 완료하지 못했습니다. 잠시 후 다시 로그인해 주세요.'
};
export default function OAuthErrorNotice(){
  const [message,setMessage]=useState('');
  useEffect(()=>{
    const params=new URLSearchParams(window.location.hash.slice(1));
    if(!params.has('oauth_error'))return;
    const code=params.get('oauth_error');
    setMessage(Object.hasOwn(messages,code)?messages[code]:messages.OAUTH_LOGIN_FAILED);
    window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
  },[]);
  return message?<p role="alert">{message}</p>:null;
}
