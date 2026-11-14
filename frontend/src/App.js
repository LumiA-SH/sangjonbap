import GuidePage from './public/GuidePage';
import CharacterDirectory from './public/CharacterDirectory';
import AnemiaNotice,{AnemiaPolicyContext} from './public/AnemiaNotice';
import CoinTransferPanel from './dev/CoinTransferPanel';
import PublicCharacterPanel from './dev/PublicCharacterPanel';
import MobileLoginHelp from './MobileLoginHelp';
import {publicAsset} from './publicAsset';
import OAuthErrorNotice from './OAuthErrorNotice';
import { useEffect, useRef, useState } from 'react';
import CharacterCreationPanel from './dev/CharacterCreationPanel';
import { api, apiUrl, setToken } from './api/client';
import AdminPanel from './admin/AdminPanel';
import {useNavigation} from './admin/navigation';
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
import { HomeHeaderDecor } from './HomeDecor';

const FALLBACK_IMAGE = publicAsset('test.png');

function NavIcon({ name, className = '' }) {
  return <img src={publicAsset(`assets/decor/icon-${name}.svg`)} alt="" aria-hidden="true" className={className} />;
}

function GameImage({ src, alt, className }) {
  const [imageSrc, setImageSrc] = useState(src || FALLBACK_IMAGE);

  useEffect(() => {
    setImageSrc(src || FALLBACK_IMAGE);
  }, [src]);

  function handleImageError() {
    if (imageSrc !== FALLBACK_IMAGE) {
      setImageSrc(FALLBACK_IMAGE);
    }
  }

  return <img src={imageSrc} alt={alt} className={className} onError={handleImageError} />;
}

function DashboardCard({ title, subtitle, action, children, className = '' }) {
  return (
      <section className={`survival-card ${className}`}>
        <div className="survival-card-title">
          <div>
            <strong>{title}</strong>
            {subtitle && <span>{subtitle}</span>}
          </div>
          {action}
        </div>
        {children}
      </section>
  );
}

function ResourceBar({ label, value, max, character }) {
  const current = Math.max(0, Number(value) || 0);
  const maximum = Math.max(1, Number(max) || 1);

  return (
      <div className="survival-resource">
        <div className="survival-resource-label">
          <b>{label}{label==='혈량'&&<AnemiaNotice character={character}/>}</b>
          <span>{current} / {maximum}</span>
        </div>
        <progress max={maximum} value={Math.min(current, maximum)} />
      </div>
  );
}

export default function App() {
  const [key, setKey] = useState('');
  const [anemiaPolicy,setAnemiaPolicy]=useState(null);
  const {route,go,back}=useNavigation();
  const view=route.tab;
  const setView=tab=>go({admin:false,tab});
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [provider, setProvider] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [user, setUser] = useState(null);
  const adminOpen=route.admin;
  const setAdminOpen=open=>go({admin:open,tab:view,menu:'dashboard'});
  const canAdmin=loggedIn && user?.role==='ADMIN' && (provider==='mastodon'||process.env.NODE_ENV!=='production');
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
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => new Date());

  const running = useRef(false);
  useEffect(()=>{if(!loggedIn||!user?.character_id){setAnemiaPolicy(null);return;}let live=true;const read=()=>api('/public/anemia').then(r=>{if(live)setAnemiaPolicy(r.settings);}).catch(()=>{if(live)setAnemiaPolicy(null);});read();window.addEventListener('focus',read);const timer=setInterval(read,60000);return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',read);};},[loggedIn,user?.character_id,revision]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let live = true;
    setAuthError(null);

    api('/auth/config')
        .then(async config => {
          if (!live) return;

          if (process.env.NODE_ENV==='production' && config.provider==='dev') throw new Error('운영 환경에서는 개발 로그인을 사용할 수 없습니다.');
          if (!['mastodon','dev'].includes(config.provider)) throw new Error('지원하지 않는 인증 설정입니다.');
          setProvider(config.provider);

          if (config.provider === 'mastodon') {
            try {
              const data = await api('/auth/me');

              if (live) {
                setUser(data.user);
                setLoggedIn(true);

                if (data.user.character_id) {
                  await refreshAll('mastodon');
                  if(!window.location.hash)go({admin:false,tab:'character'});
                }
              }
            } catch (error) {
              if (live && error.status !== 401) {
                setMessage(error.message);
              }
            }
          }
        })
        .catch(error => {
          if (live) setAuthError(error);
        });

    return () => {
      live = false;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authAttempt]);

  async function run(task) {
    if (running.current) return;

    running.current = true;
    setBusy(true);
    setMessage('');

    try {
      await task();
    } catch (error) {
      setMessage(error.message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function refreshAll(authProvider = provider) {
    const requests = [
      ['gachas', '/gacha/catalog', data => setGachas(data.gachas)],
      ['cooking', '/cooking/catalog', setCooking],
      ['products', '/shop/products', data => setProducts(data.products)],
      ['logs', '/dev/action-logs', data => setLogs(data.logs)],
      ['character', '/characters/me', data => setCharacter(data.character)],
      ['inventory', '/inventory/me', data => setInventory(data.items)],
      ['storage', '/inventory/storage', data => setStorage(data.items)],
      ['areas', '/investigation/areas', data => {
        setAreas(data.areas);
        setInvestigationApCost(data.investigationApCost);
      }]
    ].filter(([name]) => name !== 'logs' || authProvider !== 'mastodon');

    const results = await Promise.allSettled(requests.map(([, path]) => api(path)));
    const nextErrors = {};

    results.forEach((result, index) => {
      const [name, , apply] = requests[index];

      if (result.status === 'fulfilled') {
        apply(result.value);
      } else {
        nextErrors[name] = result.reason.message;
      }
    });

    setErrors(nextErrors);
    setRevision(value => value + 1);

    return Object.keys(nextErrors).length === 0;
  }

  async function login(event) {
    event.preventDefault();

    await run(async () => {
      const data = await api('/auth/dev/login', {
        method: 'POST',
        body: { key }
      });

      setToken(data.token);
      setUser(data.user);
      setKey('');
      setLoggedIn(true);

      await refreshAll();
    });
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setToken(null);
      setLoggedIn(false);
      setUser(null);
      setAdminOpen(false);
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

  const navigation = [
    ['home', '홈', 'home'],
    ['world','세계관','book'],['system','시스템 안내','book'],['schedule','러닝 일정','book'],['roster','공개 캐릭터','user'],
    ['character', '캐릭터', 'user'],
    ['investigation', '조사', 'compass'],
    ['battle', '전투', 'swords'],
    ['cooking', '요리', 'cooking'],
    ['inventory', '인벤토리', 'box'],
    ['shop', '상점', 'shop'],
    ['records', '기록', 'book'],
    ['gacha', '가챠', 'sparkle']
  ];

  const quickNavigation = [
    ['investigation', '조사', 'compass', '지역을 탐색하고 자원을 확보합니다.'],
    ['battle', '전투', 'swords', '조우한 위협과 전투를 진행합니다.'],
    ['cooking', '요리', 'cooking', '재료를 조리해 식량을 만듭니다.'],
    ['inventory', '인벤토리', 'box', '보유한 아이템을 확인하고 관리합니다.'],
    ['shop', '상점', 'shop', '필요한 물자를 구매합니다.']
  ];

  const pageDescriptions = {
    world:'공개된 세계관을 확인합니다.',system:'운영진이 등록한 시스템 안내입니다.',schedule:'러닝 일정과 진행 상태를 확인합니다.',roster:'공개된 캐릭터를 살펴봅니다.',
    home: '식량을 확보하고, 조리하고, 버텨내세요.',
    character: '생존자 정보와 상태를 확인합니다.',
    investigation: '탐사 지역과 조사 결과를 확인합니다.',
    battle: '진행 중인 전투를 확인합니다.',
    cooking: '재료를 조리하고 식사합니다.',
    inventory: '보유 물자와 공용 창고를 관리합니다.',
    shop: '보급 물자를 확인합니다.',
    records: '기록과 단서를 확인합니다.',
    gacha: '가챠 목록을 확인합니다.'
  };

  const navigate = next => {
    setView(next);
    setMenuOpen(false);
    window.scrollTo(0, 0);
  };

  const display = name => ({ display: view === name ? 'block' : 'none' });
  const maxBlood = character?.effective_max_blood ?? Math.min(100, character?.max_blood ?? 100);

  const resourceStats = character ? [
    ['HP', character.hp, character.max_hp],
    ['혈량', character.blood, maxBlood],
    ['AP', character.ap, character.max_ap]
  ] : [];

  const characterImage = character?.image_url || character?.profile_image_url || user?.avatar_url || null;
  const currentTime = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const currentDate = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

  return (
      <AnemiaPolicyContext.Provider value={anemiaPolicy}>
        {adminOpen&&<main className="admin-workspace">
          {canAdmin?<AdminPanel route={route} onNavigate={next=>go({...route,...next})} onBack={back} onExit={()=>go({admin:false,tab:view})} onLogout={()=>run(logout)} onAccessLost={()=>setUser(current=>current?{...current,role:null}:null)}/>:
              <section className="admin-gate"><h1>운영진 전용 페이지</h1><p role="alert">{provider===null?'인증 확인 중…':loggedIn?'관리자 권한이 필요합니다.':'로그인 후 관리자 권한을 확인합니다.'}</p><button onClick={()=>setAdminOpen(false)}>게임으로 돌아가기</button></section>}
        </main>}
        <div className="survival-app" hidden={adminOpen}>
          <aside className={`survival-sidebar ${menuOpen ? 'is-open' : ''}`}>
            <button type="button" className="survival-logo survival-logo-link" onClick={() => navigate('home')} aria-label="생존밥 홈으로 이동">
              <img src={publicAsset('saengjonbap_logo.png')} alt="생존밥" />
            </button>

            <nav aria-label="주 메뉴">
              {canAdmin&&<button type="button" onClick={()=>setAdminOpen(true)}>운영 관리</button>}
              {navigation.map(([id, label, symbol]) => (
                  <button key={id} type="button" className={view === id ? 'is-active' : ''} onClick={() => navigate(id)}>
                    <NavIcon name={symbol} className="survival-nav-icon" />
                    {label}
                  </button>
              ))}
            </nav>

            <div className="survival-sidebar-foot">
              <img className="survival-sidebar-cutlery" src={publicAsset('assets/decor/side-cutlery.svg')} alt="" aria-hidden="true" />
              REVIVAL COMPLETE
              <br />
              OF THE CORPSE
              <div className="survival-barcode" />
            </div>
          </aside>

          <div className="survival-main">
            <header className="survival-topbar">
              <button className="survival-menu-toggle" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label="전체 메뉴" aria-expanded={menuOpen}>☰</button>

              <button type="button" className="survival-mobile-logo survival-logo-link" onClick={() => navigate('home')} aria-label="생존밥 홈으로 이동">
                <img src={publicAsset('saengjonbap_logo.png')} alt="생존밥" />
              </button>

              <span className="survival-top-caption">SURVIVAL COOKING SYSTEM</span>
              <span className="survival-account">{character?.name || user?.username || 'SURVIVOR'}</span>
            </header>

            <div className="survival-warning" aria-hidden="true">
              <span>WARNING!</span>
              <span>WARNING!</span>
              <span>WARNING!</span>
              <span>WARNING!</span>
              <span>WARNING!</span>
            </div>

            <main className="survival-content">
              <div className="survival-heading">
                {view === 'home' && <HomeHeaderDecor />}
                <small>SURVIVOR TERMINAL</small>
                <h1>{view === 'home' ? `${character?.name ? `${character.name}, ` : ''}오늘도 생존을 이어가세요.` : navigation.find(([id]) => id === view)?.[1]}</h1>
                <p>{pageDescriptions[view]}</p>
              </div>

              {loggedIn && character?.initial_setup_complete===false && <section role="status"><h2>캐릭터 연결 완료</h2><p>{character.name}의 게임 초기 능력치가 아직 설정되지 않았습니다. 운영진이 캐릭터 관리에서 헌터 등급·이능·능력치를 설정하면 이용할 수 있습니다.</p></section>}
              {loggedIn && user?.character_id && (
                  <div className="survival-home" style={{ display: view === 'home' ? 'grid' : 'none' }}>
                    <DashboardCard title="SURVIVOR ID" subtitle={`#${String(character?.id ?? '---').padStart(3, '0')}`} className="survival-profile">
                      <div className="survival-profile-body">
                        <div className="survival-identity">
                          <GameImage src={characterImage} alt={`${character?.name || '생존자'} 프로필`} className="survival-avatar" />

                          <div className="survival-identity-info">
                            <div className="survival-identity-name">{character?.name || '불러오는 중'}</div>
                            <span className="survival-role-badge">{character?.role || '생존자'}</span>
                            <p>헌터등급 <b>{character?.hunter_grade ?? '-'}</b> <span className="survival-divider">|</span> 이능등급 <b>{character?.ability_grade ?? '-'}</b></p>
                            <p>상태: {character?.status ?? '-'}</p>
                          </div>
                        </div>

                        <div className="survival-resource-list">
                          {resourceStats.map(([label, value, max]) => (
                              <ResourceBar key={label} label={label} value={value} max={max} character={character} />
                          ))}
                        </div>
                      </div>
                    </DashboardCard>

                    <DashboardCard title="오늘의 상황" subtitle="TODAY'S STATUS" className="survival-today">
                      <div className="survival-today-body">
                        <div className="survival-calendar">
                          <span>DAY</span>
                          <strong>{String(now.getDate()).padStart(2, '0')}</strong>
                        </div>

                        <div className="survival-today-details">
                          <div><span>현재 시간</span><strong>{currentTime}</strong></div>
                          <div><span>현재 날짜</span><strong>{currentDate}</strong></div>
                          <div><span>보유 코인</span><strong>{character?.currency ?? '-'}</strong></div>
                          <div><span>진행 중 전투</span><strong>{character?.in_active_battle ? '있음' : '없음'}</strong></div>
                        </div>
                      </div>
                    </DashboardCard>

                    <DashboardCard title="주요 행동" subtitle="QUICK ACCESS" className="survival-actions-card">
                      <div className="survival-quick">
                        {quickNavigation.map(([id, label, symbol, description]) => (
                            <button key={id} type="button" onClick={() => navigate(id)}>
                              <NavIcon name={symbol} className="survival-quick-icon" />
                              <b>{label}</b>
                              <small>{description}</small>
                            </button>
                        ))}
                      </div>
                    </DashboardCard>

                    <DashboardCard title="최근 기록" subtitle="ACTIVITY LOG" action={<button type="button" className="survival-card-link" onClick={() => navigate('records')}>더보기 ›</button>} className="survival-activity">
                      <div className="survival-empty">
                        <span>MASTODON FEED</span>
                        <p>생존밥 자동 공지 기록 연동 예정</p>
                      </div>
                    </DashboardCard>

                    <DashboardCard title="현재 진행 중인 이벤트" subtitle="EVENT" className="survival-event">
                      <div className="survival-event-banner">
                        <GameImage alt="이벤트 배너 임시 이미지" className="survival-event-image" />
                        <div className="survival-event-overlay">
                          <span>EVENT</span>
                          <strong>스토리 이벤트 준비 중</strong>
                          <small>운영진 이벤트 등록 기능 연동 예정</small>
                        </div>
                      </div>
                    </DashboardCard>

                    <DashboardCard title="공지사항" subtitle="NOTICE" className="survival-notice">
                      <div className="survival-empty">
                        <span>OFFICIAL NOTICE</span>
                        <p>운영진 공지사항 연동 예정</p>
                      </div>
                    </DashboardCard>
                  </div>
              )}

              <div className="survival-auth" style={{ display: loggedIn && view !== 'home' ? 'none' : 'block' }}>
                <section aria-labelledby="login-title">
                  <OAuthErrorNotice />
                  <h2 id="login-title">{provider === 'mastodon' ? 'Mastodon 로그인' : provider === 'dev' ? '개발 로그인' : '로그인 연결'}</h2>

                  {provider === 'dev' && (
                      <p>서버의 DEV_LOGIN_KEY를 입력하세요. 토큰은 메모리에만 보관되며 새로고침하면 다시 로그인해야 합니다.</p>
                  )}

                  {!loggedIn ? (
                      provider === 'mastodon' ? (
                          <>
                            <a href={apiUrl('/auth/mastodon/login')}>Mastodon으로 로그인</a>
                            <MobileLoginHelp />
                          </>
                      ) : provider === 'dev' ? (
                          <form onSubmit={login}>
                            <label htmlFor="key">개발 로그인 키</label>
                            <input id="key" type="password" value={key} onChange={event => setKey(event.target.value)} required autoComplete="off" disabled={busy} />
                            <button disabled={busy}>로그인</button>
                          </form>
                      ) : (
                          authError ? <div role="alert">
                            <p>{authError.code?.startsWith('VERIFICATION_') ? 'API는 연결되었지만 현재 검증 제한 중입니다. 로그인은 아직 공개되지 않았습니다.' : authError.message}</p>
                            <p>{authError.code}{authError.status ? ` (HTTP ${authError.status})` : ''}</p>
                            <button onClick={() => setAuthAttempt(value => value + 1)}>연결 다시 시도</button>
                          </div> : <p>인증 방식 확인 중…</p>
                      )
                  ) : (
                      <div className="actions">
                        <span>로그인됨</span>
                        {canAdmin && <button disabled={busy} onClick={() => setAdminOpen(true)}>관리자 영역</button>}
                        <button disabled={busy} onClick={() => run(refreshAll)}>전체 상태 새로고침</button>
                        <button disabled={busy} onClick={() => run(logout)}>로그아웃</button>
                      </div>
                  )}
                </section>
              </div>

              {(busy || message) && <p className="dev-message" role="status" aria-live="polite">{busy ? '처리 중…' : message}</p>}
              {['world','system','schedule'].includes(view)&&<GuidePage key={view} kind={view}/>}
              {view==='roster'&&<CharacterDirectory recordId={route.record} onOpen={record=>go({admin:false,tab:'roster',record})} onBack={()=>go({admin:false,tab:'roster'})} canReadDetails={loggedIn&&!!user?.character_id}/>}
              {loggedIn && !user?.character_id && <CharacterCreationPanel />}

              {loggedIn && user?.character_id && (
                  <>
                    <div className="survival-page" style={display('character')}>
                      <CharacterPanel character={character} error={errors.character} busy={busy} run={run} onCharacter={setCharacter} refresh={refreshAll} notify={setMessage} dev={provider === 'dev'} />
                      <PublicCharacterPanel />
                      <CoinTransferPanel character={character} busy={busy} refresh={refreshAll} />
                      <CharacterCarePanel character={character} busy={busy} run={run} refresh={refreshAll} notify={setMessage} />
                      <TrainingBloodPanel character={character} inventory={inventory} busy={busy} run={run} refresh={refreshAll} />
                    </div>

                    <div className="survival-page" style={display('battle')}>
                      <BattlePanel inventory={inventory} busy={busy} run={run} refresh={refreshAll} revision={revision} />
                    </div>

                    <div className="survival-page" style={display('records')}>
                      <RecordsPanel />
                    </div>

                    <div className="survival-page" style={display('inventory')}>
                      <InventoryPanel character={character} inventory={inventory} storage={storage} errors={errors} busy={busy} run={run} refresh={refreshAll} notify={setMessage} />
                    </div>

                    <div className="survival-page" style={display('investigation')}>
                      <InvestigationPanel activeBattle={character?.in_active_battle} battleError={errors.character} investigationApCost={investigationApCost} areas={areas} character={character} error={errors.areas} characterError={errors.character} busy={busy} run={run} refresh={refreshAll} notify={setMessage} />
                    </div>

                    {provider === 'dev' && (
                        <div className="survival-page" style={display('records')}>
                          <ActionLogPanel logs={logs} error={errors.logs} busy={busy} run={run} refresh={refreshAll} />
                        </div>
                    )}

                    <div className="survival-page" style={display('shop')}>
                      <ShopPanel products={products} character={character} error={errors.products} busy={busy} run={run} refresh={refreshAll} notify={setMessage} />
                    </div>

                    <div className="survival-page" style={display('cooking')}>
                      <CookingPanel activeBattle={character?.in_active_battle} battleError={errors.character} inventory={inventory} catalog={cooking} character={character} error={errors.cooking} busy={busy} run={run} refresh={refreshAll} notify={setMessage} />
                    </div>

                    <div className="survival-page" style={display('gacha')}>
                      <GachaPanel gachas={gachas} character={character} error={errors.gachas} busy={busy} run={run} refresh={refreshAll} notify={setMessage} />
                    </div>
                  </>
              )}
            </main>

            <nav className="survival-bottom-nav" aria-label="모바일 메뉴">
              {navigation.filter(([id]) => ['home', 'character', 'investigation', 'battle'].includes(id)).map(([id, label, symbol]) => (
                  <button key={id} type="button" className={view === id ? 'is-active' : ''} onClick={() => navigate(id)}>
                    <NavIcon name={symbol} className="survival-nav-icon" />
                    {label}
                  </button>
              ))}

              <button type="button" onClick={() => setMenuOpen(!menuOpen)}>
                <span>☰</span>
                더보기
              </button>
            </nav>
          </div>
        </div>
      </AnemiaPolicyContext.Provider>
  );
}