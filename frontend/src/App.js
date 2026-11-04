import {useEffect,useRef, useState} from 'react';
import CharacterCreationPanel from './dev/CharacterCreationPanel';
import {api, setToken} from './api/client';
import AdminPanel from './admin/AdminPanel';
import TrainingBloodPanel from './dev/TrainingBloodPanel';
import CharacterCarePanel from './dev/CharacterCarePanel';
import ActionLogPanel from './dev/ActionLogPanel';
import ShopPanel from './dev/ShopPanel';
import CookingPanel from './dev/CookingPanel';
import GachaPanel from './dev/GachaPanel';
import CharacterPanel from './dev/CharacterPanel';
import InventoryPanel from './dev/InventoryPanel';
import InvestigationPanel from './dev/InvestigationPanel';
import RecordsPanel from './dev/RecordsPanel';
import BattlePanel from './dev/BattlePanel';

export default function App() {
  const [key, setKey] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [provider,setProvider]=useState(null),[user,setUser]=useState(null);
  useEffect(()=>{
    let live=true;
    api('/auth/config').then(async config=>{
      if(!live)return;setProvider(config.provider);
      if(config.provider==='mastodon'){
        try {const data=await api('/auth/me');if(live){setUser(data.user);setLoggedIn(true);if(data.user.character_id)await refreshAll('mastodon');}}
        catch(e){if(live&&e.status!==401)setMessage(e.message);}
      }
    }).catch(e=>{if(live)setMessage(e.message);});
    return()=>{live=false;};
    // Authentication is restored once using the HttpOnly session cookie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const [adminOpen, setAdminOpen] = useState(false);
  const [character, setCharacter] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [storage, setStorage] = useState([]);
  const [areas, setAreas] = useState([]);
  const [logs, setLogs] = useState([]);
  const [products, setProducts] = useState([]);
  const [cooking, setCooking] = useState(null);
  const [gachas, setGachas] = useState([]);
  const [investigationApCost, setInvestigationApCost] = useState(null);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision,setRevision]=useState(0);
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

  async function refreshAll(authProvider=provider) {
    const requests = [
      ['gachas', '/gacha/catalog', data => setGachas(data.gachas)],
      ['cooking', '/cooking/catalog', setCooking],
      ['products', '/shop/products', data => setProducts(data.products)],
      ['logs', '/dev/action-logs', data => setLogs(data.logs)],
      ['character', '/characters/me', data => setCharacter(data.character)],
      ['inventory', '/inventory/me', data => setInventory(data.items)],
      ['storage', '/inventory/storage', data => setStorage(data.items)],
      ['areas', '/investigation/areas', data => { setAreas(data.areas); setInvestigationApCost(data.investigationApCost); }]
    ].filter(([name])=>name!=='logs'||authProvider!=='mastodon');
    const results = await Promise.allSettled(requests.map(([, path]) => api(path)));
    const nextErrors = {};
    results.forEach((result, index) => {
      const [name, , apply] = requests[index];
      if (result.status === 'fulfilled') apply(result.value);
      else nextErrors[name] = result.reason.message;
    });
    setErrors(nextErrors);
    setRevision(value=>value+1);
    return Object.keys(nextErrors).length === 0;
  }

  async function login(event) {
    event.preventDefault();
    await run(async () => {
      const data = await api('/auth/dev/login', {method: 'POST', body: {key}});
      setToken(data.token);
      setUser(data.user);
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
      setUser(null);setAdminOpen(false);
      setCharacter(null);
      setInventory([]);
      setStorage([]);
      setAreas([]);
      setLogs([]);
      setProducts([]);
      setCooking(null);
      setGachas([]);
      setInvestigationApCost(null);
      setErrors({});
      setMessage('');
    }
  }

  if (loggedIn && adminOpen) return <main><AdminPanel onBack={() => setAdminOpen(false)}/></main>;

  return <main>
    <header>
      <span className="badge">SANGJONBAP / DEV CONSOLE</span>
      <h1>생존밥 개발실</h1>
      <p>백엔드 기능 검증용 화면입니다. 조작은 연결된 DB에 실제로 반영됩니다.</p>
    </header>
    <section aria-labelledby="login-title">
      <h2 id="login-title">{provider==='mastodon'?'Mastodon 로그인':'개발 로그인'}</h2>
      {provider==='dev'&&<p>서버의 DEV_LOGIN_KEY를 입력하세요. 토큰은 메모리에만 보관되며 새로고침하면 다시 로그인해야 합니다.</p>}
      {!loggedIn ? provider==='mastodon'?<a href="/api/auth/mastodon/login">Mastodon으로 로그인</a>:provider==='dev'?<form onSubmit={login}>
        <label htmlFor="key">개발 로그인 키</label>
        <input id="key" type="password" value={key} onChange={event => setKey(event.target.value)} required autoComplete="off" disabled={busy}/>
        <button disabled={busy}>로그인</button>
      </form>:<p>인증 방식 확인 중…</p> : <div className="actions">
        <span>로그인됨</span>
        {user?.role==='ADMIN'&&<button disabled={busy} onClick={() => setAdminOpen(true)}>관리자 영역</button>}
        <button disabled={busy} onClick={() => run(refreshAll)}>전체 상태 새로고침</button>
        <button disabled={busy} onClick={() => run(logout)}>로그아웃</button>
      </div>}
    </section>
    <p className="dev-message" role="status" aria-live="polite">{busy ? '처리 중…' : message}</p>
    {loggedIn&&!user?.character_id&&<CharacterCreationPanel/>}
    {loggedIn&&user?.character_id && <>
      <CharacterPanel character={character} error={errors.character} busy={busy} run={run}
        onCharacter={setCharacter} refresh={refreshAll} notify={setMessage} dev={provider==='dev'}/>
      <CharacterCarePanel character={character} busy={busy} run={run} refresh={refreshAll} notify={setMessage}/>
      <TrainingBloodPanel character={character} inventory={inventory} busy={busy} run={run} refresh={refreshAll}/>
      <BattlePanel inventory={inventory} busy={busy} run={run} refresh={refreshAll} revision={revision}/>
      <details className="dev-fold"><summary>기록·단서 아카이브</summary><RecordsPanel/></details>
      <details className="dev-fold"><summary>인벤토리·공용 창고</summary>
      <InventoryPanel character={character} inventory={inventory} storage={storage} errors={errors} busy={busy} run={run}
        refresh={refreshAll} notify={setMessage}/>
      </details>
      <details className="dev-fold" open><summary>조사</summary>
      <InvestigationPanel activeBattle={character?.in_active_battle} battleError={errors.character} investigationApCost={investigationApCost} areas={areas} character={character} error={errors.areas} characterError={errors.character}
        busy={busy} run={run} refresh={refreshAll} notify={setMessage}/>
      </details>
      {provider==='dev'&&<details className="dev-fold"><summary>최근 행동 로그</summary>
        <ActionLogPanel logs={logs} error={errors.logs} busy={busy} run={run} refresh={refreshAll}/>
      </details>}
      <details className="dev-fold"><summary>상점</summary>
        <ShopPanel products={products} character={character} error={errors.products} busy={busy}
          run={run} refresh={refreshAll} notify={setMessage}/>
      </details>
      <details className="dev-fold"><summary>요리·식사</summary>
        <CookingPanel activeBattle={character?.in_active_battle} battleError={errors.character} inventory={inventory} catalog={cooking} character={character} error={errors.cooking} busy={busy}
          run={run} refresh={refreshAll} notify={setMessage}/>
      </details>
      <details className="dev-fold"><summary>가챠</summary>
        <GachaPanel gachas={gachas} character={character} error={errors.gachas} busy={busy}
          run={run} refresh={refreshAll} notify={setMessage}/>
      </details>
    </>}
    <footer>CRA → JavaScript API → Supabase PostgreSQL · DEV 전용, 최종 서비스 화면 아님</footer>
  </main>;
}
