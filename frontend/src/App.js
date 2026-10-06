import {useRef, useState} from 'react';
import {api, setToken} from './api/client';
import CharacterPanel from './dev/CharacterPanel';
import InventoryPanel from './dev/InventoryPanel';
import InvestigationPanel from './dev/InvestigationPanel';

export default function App() {
  const [key, setKey] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [character, setCharacter] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [storage, setStorage] = useState([]);
  const [areas, setAreas] = useState([]);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  async function run(task) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage('');
    try { await task(); }
    catch (error) { setMessage(error.message); }
    finally { running.current = false; setBusy(false); }
  }

  async function refreshAll() {
    const requests = [
      ['character', '/characters/me', data => setCharacter(data.character)],
      ['inventory', '/inventory/me', data => setInventory(data.items)],
      ['storage', '/inventory/storage', data => setStorage(data.items)],
      ['areas', '/investigation/areas', data => setAreas(data.areas)]
    ];
    const results = await Promise.allSettled(requests.map(([, path]) => api(path)));
    const nextErrors = {};
    results.forEach((result, index) => {
      const [name, , apply] = requests[index];
      if (result.status === 'fulfilled') apply(result.value);
      else nextErrors[name] = result.reason.message;
    });
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function login(event) {
    event.preventDefault();
    await run(async () => {
      const data = await api('/auth/dev/login', {method: 'POST', body: {key}});
      setToken(data.token);
      setKey('');
      setLoggedIn(true);
      await refreshAll();
    });
  }

  async function logout() {
    try { await api('/auth/logout', {method: 'POST'}); }
    finally {
      setToken(null);
      setLoggedIn(false);
      setCharacter(null);
      setInventory([]);
      setStorage([]);
      setAreas([]);
      setErrors({});
      setMessage('');
    }
  }

  return <main>
    <header>
      <span className="badge">SANGJONBAP / DEV CONSOLE</span>
      <h1>생존밥 개발실</h1>
      <p>백엔드 기능 검증용 화면입니다. 조작은 연결된 DB에 실제로 반영됩니다.</p>
    </header>
    <section aria-labelledby="login-title">
      <h2 id="login-title">개발 로그인</h2>
      <p>서버의 DEV_LOGIN_KEY를 입력하세요. 토큰은 메모리에만 보관되며 새로고침하면 다시 로그인해야 합니다.</p>
      {!loggedIn ? <form onSubmit={login}>
        <label htmlFor="key">개발 로그인 키</label>
        <input id="key" type="password" value={key} onChange={event => setKey(event.target.value)} required autoComplete="off" disabled={busy}/>
        <button disabled={busy}>로그인</button>
      </form> : <div className="actions">
        <span>로그인됨</span>
        <button disabled={busy} onClick={() => run(refreshAll)}>전체 상태 새로고침</button>
        <button disabled={busy} onClick={() => run(logout)}>로그아웃</button>
      </div>}
    </section>
    <p className="dev-message" role="status" aria-live="polite">{busy ? '처리 중…' : message}</p>
    {loggedIn && <>
      <CharacterPanel character={character} error={errors.character} busy={busy} run={run}
        onCharacter={setCharacter} refresh={refreshAll} notify={setMessage}/>
      <InventoryPanel inventory={inventory} storage={storage} errors={errors} busy={busy} run={run}
        refresh={refreshAll} notify={setMessage}/>
      <InvestigationPanel areas={areas} character={character} error={errors.areas} characterError={errors.character}
        busy={busy} run={run} refresh={refreshAll} notify={setMessage}/>
    </>}
    <footer>CRA → JavaScript API → Supabase PostgreSQL · DEV 전용, 최종 서비스 화면 아님</footer>
  </main>;
}
