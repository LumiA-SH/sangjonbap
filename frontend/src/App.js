import {useState} from 'react';
import {api,setToken} from './api/client';

export default function App(){
  const [key,setKey]=useState(''),[character,setCharacter]=useState(null),[name,setName]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loggedIn,setLoggedIn]=useState(false);

  async function run(task){
    setBusy(true);
    setMessage('');
    try{
      await task();
    }catch(e){
      setMessage(e.message);
    }finally{
      setBusy(false);
    }
  }

  async function refresh(){
    const data=await api('/characters/me');
    setCharacter(data.character);
    setName(data.character.name);
  }

  async function testAp(){
    const data=await api('/characters/me/resources',{
      method:'PATCH',
      body:{
        ap:-1,
        reason:'DEV_RESOURCE_TEST'
      }
    });
    setCharacter(data.character);
    setMessage('AP -1 처리 완료');
  }

  return <main>
    <header>
      <span className="badge">SANGJONBAP / DEV</span>
      <h1>생존밥 개발실</h1>
      <p>로그인부터 캐릭터 코어까지, 첫 번째 연결.</p>
    </header>

    <section>
      <h2>개발 로그인</h2>
      <p>서버의 DEV_LOGIN_KEY를 입력하세요. 메모리 모드는 재시작 시 초기화됩니다.</p>

      <form onSubmit={e=>{
        e.preventDefault();
        run(async()=>{
          const data=await api('/auth/dev/login',{method:'POST',body:{key}});
          setToken(data.token);
          setLoggedIn(true);
          setKey('');
          await refresh();
        });
      }}>
        <label htmlFor="key">개발 로그인 키</label>
        <input id="key" type="password" value={key} onChange={e=>setKey(e.target.value)} required autoComplete="off"/>
        <button disabled={busy}>로그인</button>
      </form>

      {loggedIn&&<div className="actions">
        <button disabled={busy} onClick={()=>run(refresh)}>캐릭터 새로고침</button>
        <button disabled={busy} onClick={()=>run(async()=>{
          try{
            await api('/auth/logout',{method:'POST'});
          }finally{
            setToken(null);
            setLoggedIn(false);
            setCharacter(null);
          }
        })}>로그아웃</button>
      </div>}
    </section>

    {character&&<section>
      <span className="badge">CHARACTER CORE</span>
      <h2>{character.name}</h2>

      <div className="stats">
        {[
          ['HP',character.hp+'/'+character.max_hp],
          ['AP',character.ap+'/'+character.max_ap],
          ['혈액',character.blood+'/'+character.max_blood],
          ['재화',character.currency]
        ].map(([label,value])=><div key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </div>)}
      </div>

      <p>등급 {character.hunter_grade} · 상태 {character.status}</p>

      <div className="actions">
        <button disabled={busy||character.ap<=0} onClick={()=>run(testAp)}>AP -1 테스트</button>
      </div>

      <form onSubmit={e=>{
        e.preventDefault();
        run(async()=>{
          const data=await api('/characters/me/profile',{method:'PATCH',body:{name}});
          setCharacter(data.character);
          setMessage('이름을 저장했습니다.');
        });
      }}>
        <label htmlFor="name">캐릭터 이름</label>
        <input id="name" value={name} maxLength={40} required onChange={e=>setName(e.target.value)}/>
        <button disabled={busy}>이름 저장</button>
      </form>
    </section>}

    <p role="status" aria-live="polite">{busy?'처리 중…':message}</p>
    <footer>CRA → JavaScript API → Supabase PostgreSQL</footer>
  </main>;
}