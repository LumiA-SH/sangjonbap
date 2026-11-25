import {trainingSummary} from './dev/actionPresentation';
import EventFeed from './public/EventFeed';
import RequestLoading from './api/RequestLoading';
import NoticeFeed from './public/NoticeFeed';
import SystemFeed,{feedTitles} from './public/SystemFeed';
import GuidePage from './public/GuidePage';
import PublicHome from './public/PublicHome';
import CharacterDirectory from './public/CharacterDirectory';
import AnemiaNotice, {AnemiaPolicyContext,characterStateText} from './public/AnemiaNotice';
import {publicAsset} from './publicAsset';
import {useEffect, useRef, useState} from 'react';
import CharacterCreationPanel from './dev/CharacterCreationPanel';
import CharacterWorkspace from './dev/CharacterWorkspace';
import {api, setToken} from './api/client';
import AdminPanel from './admin/AdminPanel';
import {useNavigation} from './admin/navigation';
import ShopPanel from './dev/ShopPanel';
import CookingPanel from './dev/CookingPanel';
import GachaPanel from './dev/GachaPanel';
import InventoryPanel from './dev/InventoryPanel';
import InvestigationPanel from './dev/InvestigationPanel';
import RecordsPanel from './dev/RecordsPanel';
import BattlePanel from './dev/BattlePanel';
import {PageHeader, HomeCardDecor} from './HomeDecor';
import DicePanel from './dev/DicePanel';
import './AccountMenu.css';

const FALLBACK_IMAGE = publicAsset('test.png');
const publicTabs = ['feed-activity','feed-notice','feed-event','home', 'world', 'system', 'schedule', 'roster'];

function NavIcon({name, className = ''}) {
  const shapes = {
    gift: <><path d="M3 11h18v11H3ZM2 7h20v4H2ZM12 7v15"/><path d="M12 7H8a3 3 0 1 1 3-3Zm0 0h4a3 3 0 1 0-3-3Z"/></>,
    menu: <path d="M4 6h16M4 13h16M4 20h16"/>,
    home: <><path d="M3 10 12 3l9 7v11h-6v-7H9v7H3Z"/></>,
    book: <><path d="M12 5v16M12 5C9 3 5 3 2 5v15c3-2 7-2 10 1 3-3 7-3 10-1V5c-3-2-7-2-10 0Z"/></>,
    user: <><circle cx="12" cy="7" r="4"/><path d="M3 21v-2a9 9 0 0 1 18 0v2Z"/></>,
    compass: <><circle cx="12" cy="12" r="10"/><path d="m16 8-3 5-5 3 3-5Z"/></>,
    swords: <><path d="m3 3 5 2 12 14-1 1L5 8ZM21 3l-5 2L4 19l1 1L19 8ZM3 15l6 6M15 21l6-6"/></>,
    cooking: <><path d="M2 11h20M4 11v4a7 7 0 0 0 7 7h2a7 7 0 0 0 7-7v-4M8 8c3-3-3-3 0-6M15 8c3-3-3-3 0-6"/></>,
    box: <><path d="m12 2 10 6v10l-10 5-10-5V8ZM2 8l10 5 10-5M12 13v10"/></>,
    shop: <><path d="m2 8 10-6 10 6-10 6ZM2 13l10 6 10-6M2 18l10 5 10-5"/></>,
    sparkle: <><path d="m12 2 10 6v10l-10 5-10-5V8ZM2 8l10 5 10-5M12 13v10"/><g fill="currentColor" stroke="none"><circle cx="9" cy="7" r="1"/><circle cx="15" cy="7" r="1"/><circle cx="6" cy="13" r="1"/><circle cx="8" cy="18" r="1"/><circle cx="17" cy="16" r="1"/></g></>
  };

  return (
      <svg className={className} viewBox="0 0 24 26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {shapes[name] || shapes.book}
      </svg>
  );
}

function GameImage({src, alt, className}) {
  const [imageSrc, setImageSrc] = useState(src || FALLBACK_IMAGE);

  useEffect(() => {
    setImageSrc(src || FALLBACK_IMAGE);
  }, [src]);

  function handleImageError() {
    if (imageSrc !== FALLBACK_IMAGE) {
      setImageSrc(FALLBACK_IMAGE);
    }
  }

  return <img src={imageSrc} alt={alt} className={className} onError={handleImageError}/>;
}

function DashboardCard({title, subtitle, action, children, className = ''}) {
  return (
      <section className={`survival-card ${className}`}>
        <HomeCardDecor type={className.replace('survival-', '')}/>
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

function ResourceBar({label, value, max, character}) {
  const current = Math.max(0, Number(value) || 0);
  const maximum = Math.max(1, Number(max) || 1);

  return (
      <div className="survival-resource">
        <div className="survival-resource-label">
          <b>{label}{label === '혈량' && <AnemiaNotice character={character}/>}</b>
          <span>{current} / {maximum}</span>
        </div>
        <progress max={maximum} value={Math.min(current, maximum)}/>
      </div>
  );
}

function HomeCoreStats({character}) {
  const stats = [
    ['ATK', character?.atk],
    ['DEF', character?.def],
    ['AGI', character?.agi]
  ];

  return (
      <div className="survival-core-stats" aria-label="캐릭터 기본 능력치">
        {stats.map(([label, value]) => (
            <div className="survival-core-stat" key={label}>
              <span>{label}</span>
              <strong>{value ?? '-'}</strong>
            </div>
        ))}
      </div>
  );
}

function getKstDay(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const values = Object.fromEntries(
      parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function HomeDailyTraining({character, busy, run, refresh, today}) {
  const [completed, setCompleted] = useState(null);
  const [message, setMessage] = useState('');
  const sending = useRef(false);

  const serverDay = String(character?.last_training_date ?? '').slice(0, 10);
  const isCompleted = serverDay === today ||
      (completed?.characterId === String(character?.id) && completed.day === today);

  const unavailable = !character ||
      character.initial_setup_complete === false ||
      character.status !== 'ALIVE' ||
      character.in_active_battle;

  const disabled = busy || unavailable || isCompleted;

  async function train() {
    if (disabled || sending.current) return;

    sending.current = true;

    try {
      await run(async () => {
        setMessage('');

        let result;

        try {
          result = await api('/training', {
            method: 'POST',
            body: {requestKey: crypto.randomUUID()}
          });
        } catch (error) {
          if (error.code === 'TRAINING_ALREADY_DONE') {
            setCompleted({
              characterId: String(character.id),
              day: today
            });
            setMessage('오늘 훈련 완료');
          } else {
            setMessage(`${error.code || 'TRAINING_FAILED'}: ${error.message}`);
          }

          return;
        }

        setCompleted({
          characterId: String(character.id),
          day: String(result.day || today).slice(0, 10)
        });

        try {
          const synced = await refresh();
          setMessage(trainingSummary(result) + (synced ? '' : ' · 일부 상태 갱신 실패'));
        } catch {
          setMessage(trainingSummary(result) + ' · 상태를 다시 불러와 주세요.');
        }
      });
    } finally {
      sending.current = false;
    }
  }

  return (
      <div className="survival-training-slot">
        <button type="button" className="survival-training-button" disabled={disabled} onClick={train}>
          {isCompleted ? '훈련 완료' : '일일훈련'}
        </button>
        <small className="survival-training-hint">
          {isCompleted ? '오늘 훈련 완료' : unavailable ? '현재 이용 불가' : 'KST 하루 1회'}
        </small>
        {message && <span className="survival-training-message" role="status">{message}</span>}
      </div>
  );
}

export default function App() {
  const [key, setKey] = useState('');
  const [anemiaPolicy, setAnemiaPolicy] = useState(null);
  const {route, go, back} = useNavigation();
  const view = route.tab;
  const setView = tab => go({admin: false, tab});
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutsideMenu = event => {
      if (!window.matchMedia('(max-width: 900px)').matches) return;
      if (event.target instanceof Element && event.target.closest('.survival-sidebar, [data-sidebar-toggle]')) return;
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutsideMenu, true);
    return () => document.removeEventListener('pointerdown', closeOutsideMenu, true);
  }, [menuOpen]);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [provider, setProvider] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [user, setUser] = useState(null);
  const adminOpen = route.admin;
  const setAdminOpen = open => go({admin: open, tab: view, menu: 'dashboard'});
  const canAdmin = loggedIn && user?.role === 'ADMIN' && (provider === 'mastodon' || process.env.NODE_ENV !== 'production');
  const [character, setCharacter] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [storage, setStorage] = useState([]);
  const [areas, setAreas] = useState([]);
  const [globalInvestigationRate, setGlobalInvestigationRate] = useState(null);

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
  const adminWasOpen = useRef(false);
  const lastDataView = useRef(null);
  const accountMenuRef = useRef(null);

  useEffect(() => {
    if (!accountMenuOpen) return;

    function handlePointerDown(event) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) setAccountMenuOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setAccountMenuOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountMenuOpen]);

  async function refreshAfterAdmin(){
    try{
      const result=await api('/characters/me');
      setCharacter(result.character);
      setErrors(previous=>({...previous,character:undefined}));
    }catch(error){
      setErrors(previous=>({...previous,character:error.message}));
    }
  }

  useEffect(()=>{
    if(adminOpen){
      adminWasOpen.current=true;
      return;
    }

    if(!adminWasOpen.current)return;
    adminWasOpen.current=false;

    if(loggedIn&&user?.character_id){
      refreshAfterAdmin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[adminOpen,loggedIn,user?.character_id]);

  useEffect(() => {
    if (!loggedIn || !user?.character_id) {
      setAnemiaPolicy(null);
      return;
    }

    if (adminOpen) return;
    let live = true;

    const read = () => api('/public/anemia').then(r => {
      if (live) setAnemiaPolicy(r.settings);
    }).catch(() => {
      if (live) setAnemiaPolicy(null);
    });

    read();


    return () => {
      live = false;

    };
  }, [loggedIn, user?.character_id, adminOpen]);

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

          if (process.env.NODE_ENV === 'production' && config.provider === 'dev') {
            throw new Error('운영 환경에서는 개발 로그인을 사용할 수 없습니다.');
          }

          if (!['mastodon', 'dev'].includes(config.provider)) {
            throw new Error('지원하지 않는 인증 설정입니다.');
          }

          setProvider(config.provider);

          if (config.provider === 'mastodon') {
            try {
              const data = await api('/auth/me');

              if (live) {
                setUser(data.user);
                setLoggedIn(true);

                if (data.user.character_id) {
                  await refreshAll('mastodon');
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

  async function refreshAll(sections = null, refreshBattle = true) {
    const requests = [
      ['gachas', '/gacha/catalog', data => setGachas(data.gachas)],
      ['cooking', '/cooking/catalog', setCooking],
      ['products', '/shop/products', data => setProducts(data.products)],

      ['character', '/characters/me', data => setCharacter(data.character)],
      ['inventory', '/inventory/me', data => setInventory(data.items)],
      ['storage', '/inventory/storage', data => setStorage(data.items)],
      ['areas', '/investigation/areas', data => {
        setAreas(data.areas);
        setGlobalInvestigationRate(data.globalInvestigationRate);
        setInvestigationApCost(data.investigationApCost);
      }]
    ].filter(([name]) => !Array.isArray(sections) || sections.includes(name));

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

    setErrors(previous => {
      const next = {...previous};
      for (const [name] of requests) delete next[name];
      return {...next, ...nextErrors};
    });
    if (refreshBattle) setRevision(value => value + 1);

    return Object.keys(nextErrors).length === 0;
  }

  useEffect(() => {
    if (!loggedIn || !user?.character_id) {
      lastDataView.current = null;
      return;
    }
    if (adminOpen || revision === 0) return;
    if (lastDataView.current === view) return;

    const previous = lastDataView.current;
    lastDataView.current = view;
    // The initial full refresh already includes the first visible screen.
    if (previous === null) return;

    const sections = {
      home: ['character'],
      character: ['character', 'inventory'],
      inventory: ['character', 'inventory', 'storage', 'cooking'],
      shop: ['character', 'products'],
      cooking: ['character', 'inventory', 'cooking'],
      investigation: ['character', 'areas'],
      gacha: ['character', 'gachas'],
      battle: ['inventory']
    }[view];
    if (sections) refreshAll(sections, false);
    // A tab entry refresh does not trigger another battle query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, revision, loggedIn, user?.character_id, adminOpen]);

  async function login(event) {
    event.preventDefault();

    await run(async () => {
      const data = await api('/auth/dev/login', {
        method: 'POST',
        body: {key}
      });

      setToken(data.token);
      setUser(data.user);
      setKey('');
      setLoggedIn(true);

      await refreshAll();
    });
  }

  async function logout() {
    setAccountMenuOpen(false);
    try {
      await api('/auth/logout', {method: 'POST'});
    } finally {
      setToken(null);
      setLoggedIn(false);
      setUser(null);
      setAdminOpen(false);
      setCharacter(null);
      setInventory([]);
      setStorage([]);
      setAreas([]);
      setGlobalInvestigationRate(null);

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
    ['world', '세계관', 'book'],
    ['system', '시스템 안내', 'book'],
    ['schedule', '러닝 일정', 'book'],
    ['roster', '공개 캐릭터', 'user'],
    ['character', '캐릭터', 'user'],
    ['dice', '주사위', 'sparkle'],
    ['investigation', '조사', 'compass'],
    ['battle', '전투', 'swords'],
    ['cooking', '요리', 'cooking'],
    ['inventory', '인벤토리', 'box'],
    ['shop', '상점', 'shop'],
    ['gacha', '뽑기', 'gift'],
    ['records', '기록', 'book']
  ];

  const quickNavigation = [
    ['investigation', '조사', 'compass', '지역을 탐색하고 자원을 확보합니다.'],
    ['battle', '전투', 'swords', '조우한 위협과 전투를 진행합니다.'],
    ['cooking', '요리', 'cooking', '재료를 조리해 식량을 만듭니다.'],
    ['inventory', '인벤토리', 'box', '보유한 아이템을 확인하고 관리합니다.'],
    ['shop', '상점', 'shop', '필요한 물자를 구매합니다.'],
    ['gacha', '뽑기', 'gift', '뽑기를 통해 다양한 보상을 획득합니다.']
  ];

  const pageDescriptions = {
    world: '공개된 세계관을 확인합니다.',
    system: '운영진이 등록한 시스템 안내입니다.',
    schedule: '러닝 일정과 진행 상태를 확인합니다.',
    roster: '공개된 캐릭터를 살펴봅니다.',
    home: '식량을 확보하고, 조리하고, 버텨내세요.',
    character: '생존자 정보와 상태를 확인합니다.',
    dice: '1D100 주사위를 굴리고 결과를 확인합니다.',
    investigation: '탐사 지역과 조사 결과를 확인합니다.',
    battle: '진행 중인 전투를 확인합니다.',
    cooking: '재료를 조리하고 식사합니다.',
    inventory: '보유 물자와 공용 창고를 관리합니다.',
    shop: '보급 물자를 확인합니다.',
    records: '기록과 단서를 확인합니다.',
    gacha: '뽑기 목록을 확인합니다.'
  };

  useEffect(() => {setMessage('');}, [view]);

  const navigate = next => {
    setAccountMenuOpen(false);
    setView(next);
    setMenuOpen(false);
    window.scrollTo(0, 0);
  };

  const display = name => ({display: view === name ? 'block' : 'none'});
  const maxBlood = character?.effective_max_blood ?? Math.min(100, character?.max_blood ?? 100);

  const resourceStats = character ? [
    ['HP', character.hp, character.max_hp],
    ['혈량', character.blood, maxBlood],
    ['AP', character.ap, character.max_ap]
  ] : [];

  const characterImage = character?.image_url || character?.profile_image_url || user?.avatar_url || null;
  const currentTime = now.toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit', hour12: false});
  const currentDate = now.toLocaleDateString('ko-KR', {year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'});
  const today = getKstDay(now);

  return (
      <AnemiaPolicyContext.Provider value={anemiaPolicy}>
        <RequestLoading/>
        {adminOpen && <main className="admin-workspace">
          {canAdmin ? <AdminPanel route={route} onNavigate={next => go({...route, ...next})} onBack={back} onExit={() => go({admin: false, tab: view})} onLogout={() => run(logout)} onAccessLost={() => setUser(current => current ? {...current, role: null} : null)}/> :
              <section className="admin-gate">
                <h1>운영진 전용 페이지</h1>
                <p role="alert">{provider === null ? '인증 확인 중…' : loggedIn ? '관리자 권한이 필요합니다.' : '로그인 후 관리자 권한을 확인합니다.'}</p>
                <button onClick={() => setAdminOpen(false)}>게임으로 돌아가기</button>
              </section>}
        </main>}

        <div className="survival-app" hidden={adminOpen}>
          <aside className={`survival-sidebar ${menuOpen ? 'is-open' : ''}`}>
            <button type="button" className="survival-logo survival-logo-link" onClick={() => navigate('home')} aria-label="생존밥 홈으로 이동">
              <img src={publicAsset('saengjonbap_logo.png')} alt="생존밥"/>
            </button>

            <nav aria-label="주 메뉴">
              {canAdmin && <button type="button" onClick={() => setAdminOpen(true)}>운영 관리</button>}
              {navigation
                  .filter(([id]) => loggedIn || publicTabs.includes(id))
                  .map(([id, label, symbol]) => (
                      <button key={id} type="button" className={view === id ? 'is-active' : ''} onClick={() => navigate(id)}>
                        <NavIcon name={symbol} className="survival-nav-icon"/>
                        {label}
                      </button>
                  ))}
            </nav>

            <div className="survival-sidebar-foot">
              <img className="survival-sidebar-cutlery" src={publicAsset('assets/decor/crossed-cutlery-approved.png')} alt="" aria-hidden="true"/>
              REVIVAL COMPLETE
              <br/>
              OF THE CORPSE
              <div className="survival-barcode"/>
            </div>
          </aside>

          <div className="survival-main">
            <header className="survival-topbar">
              <button className="survival-menu-toggle" data-sidebar-toggle type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label="전체 메뉴" aria-expanded={menuOpen}>☰</button>

              <button type="button" className="survival-mobile-logo survival-logo-link" onClick={() => navigate('home')} aria-label="생존밥 홈으로 이동">
                <img src={publicAsset('saengjonbap_logo.png')} alt="생존밥"/>
              </button>

              <span className="survival-top-caption">SURVIVAL COOKING SYSTEM</span>
              {loggedIn ? (
                  <div className="survival-account-menu" ref={accountMenuRef}>
                    <button type="button" className="survival-account-trigger" aria-expanded={accountMenuOpen} aria-controls="survival-account-dropdown" onClick={() => setAccountMenuOpen(open => !open)}>
                      <span className="survival-account">{character?.name || user?.username || 'SURVIVOR'}</span>
                      <span className={`survival-account-chevron${accountMenuOpen ? ' is-open' : ''}`} aria-hidden="true">▾</span>
                    </button>
                    {accountMenuOpen && (
                        <div id="survival-account-dropdown" className="survival-account-dropdown" aria-label="계정 메뉴">
                          <div className="survival-account-profile">
                            <strong>{character?.name || user?.username || 'SURVIVOR'}</strong>
                            <small>{user?.username || '로그인됨'}</small>
                          </div>
                          {canAdmin && <button type="button" disabled={busy} onClick={() => {setAccountMenuOpen(false); setAdminOpen(true);}}>관리자 영역</button>}
                          <button type="button" disabled={busy} onClick={() => {setAccountMenuOpen(false); run(refreshAll);}}>전체 상태 새로고침</button>
                          <button type="button" className="survival-account-logout" disabled={busy} onClick={() => {setAccountMenuOpen(false); run(logout);}}>로그아웃</button>
                        </div>
                    )}
                  </div>
              ) : <span className="survival-account">SURVIVOR</span>}
            </header>

            <div className="survival-warning" aria-hidden="true">
              {Array.from({length: 24}, (_, index) => <span key={index}><b>WARNING!</b></span>)}
            </div>

            <main className="survival-content">
              <PageHeader
                  title={view === 'home' ? `${character?.name ? `${character.name}, ` : ''}오늘도 생존을 이어가세요.` : navigation.find(([id]) => id === view)?.[1] || {'feed-activity': '최근 기록', 'feed-notice': '공지사항', 'feed-event': '이벤트'}[view]}
                  description={pageDescriptions[view]}
              />

              {!loggedIn && view === 'home' && (
                  <PublicHome
                      provider={provider}
                      authError={authError}
                      devKey={key}
                      onDevKeyChange={setKey}
                      onDevLogin={login}
                      onRetry={() => setAuthAttempt(value => value + 1)}
                      onNavigate={navigate}
                      busy={busy}
                  />
              )}

              {loggedIn && character?.initial_setup_complete === false && <section role="status">
                <h2>캐릭터 연결 완료</h2>
                <p>{character.name}의 게임 초기 능력치가 아직 설정되지 않았습니다. 운영진이 캐릭터 관리에서 헌터 등급·이능·능력치를 설정하면 이용할 수 있습니다.</p>
              </section>}

              {loggedIn && character && ['investigation', 'cooking', 'battle'].includes(view) && (
                  <details className="survival-resource-indicator" open>
                    <summary>현재 캐릭터 상태</summary>
                    <span>HP <strong>{character.hp}</strong></span>
                    <span>혈량 <strong>{character.blood}</strong>/100</span>
                    <span>AP <strong>{character.ap}</strong></span>
                  </details>
              )}

              {loggedIn && user?.character_id && (
                  <div className="survival-home" style={{display: view === 'home' ? 'grid' : 'none'}}>
                    <DashboardCard title="SURVIVOR ID" subtitle={`#${String(character?.id ?? '---').padStart(3, '0')}`} className="survival-profile">
                      <div className="survival-profile-body">
                        <div className="survival-identity">
                          <GameImage src={characterImage} alt={`${character?.name || '생존자'} 프로필`} className="survival-avatar"/>

                          <div className="survival-identity-info">
                            <div className="survival-identity-name">{character?.name || '불러오는 중'}</div>
                            <span className="survival-role-badge">{character?.role || '생존자'}</span>
                            <p>헌터등급 <b>{character?.hunter_grade ?? '-'}</b> <span className="survival-divider">|</span> 이능등급 <b>{character?.ability_grade ?? '-'}</b></p>
                            <p>상태: <strong>{characterStateText(character,anemiaPolicy)}</strong></p>
                          </div>
                        </div>

                        <HomeDailyTraining character={character} busy={busy} run={run} refresh={refreshAll} today={today}/>

                        <div className="survival-resource-list">
                          {resourceStats.map(([label, value, max]) => (
                              <ResourceBar key={label} label={label} value={value} max={max} character={character}/>
                          ))}

                          <HomeCoreStats character={character}/>
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

                      {view === 'home' && <DicePanel/>}
                    </DashboardCard>

                    <DashboardCard title="주요 행동" subtitle="QUICK ACCESS" className="survival-actions-card">
                      <div className="survival-quick">
                        {quickNavigation.map(([id, label, symbol, description]) => (
                            <button key={id} type="button" onClick={() => navigate(id)}>
                              <NavIcon name={symbol} className="survival-quick-icon"/>
                              <b>{label}</b>
                              <small>{description}</small>
                            </button>
                        ))}
                      </div>
                    </DashboardCard>

                    <DashboardCard title="공지사항" subtitle="NOTICE" action={<button type="button" className="survival-card-link" onClick={() => navigate('feed-notice')}>더보기 ›</button>} className="survival-notice">
                      <NoticeFeed preview active={view==='home'} onOpen={id => go({admin: false, tab: 'feed-notice', record: String(id)})}/>
                    </DashboardCard>

                    <DashboardCard title="이벤트" subtitle="EVENT" action={<button type="button" className="survival-card-link" onClick={()=>navigate('feed-event')}>더보기 ›</button>} className="survival-event">
                      <EventFeed banner active={view==='home'} onOpen={record=>go({admin:false,tab:'feed-event',record})}/>
                    </DashboardCard>

                    <DashboardCard title="최근 기록" subtitle="ACTIVITY LOG" action={<button type="button" className="survival-card-link" onClick={() => navigate('feed-activity')}>더보기 ›</button>} className="survival-activity">
                      <SystemFeed kind="activity" preview active={view==='home'}/>
                    </DashboardCard>
                  </div>
              )}

              {!loggedIn && !publicTabs.includes(view) && (
                  <section className="survival-card" role="status">
                    <h2>로그인이 필요한 메뉴입니다.</h2>
                    <p>게임 기능은 생존자 인증 후 이용할 수 있습니다.</p>
                    <button type="button" onClick={() => navigate('home')}>홈으로 이동</button>
                  </section>
              )}

              {view !== 'home' && (busy || message) && <p className="dev-message" role="status" aria-live="polite">{busy ? '처리 중…' : message}</p>}

              {view.startsWith('feed-') && (
                  view === 'feed-notice' ? (
                      <section className="survival-card survival-notice-page">
                        <header className="survival-notice-page-heading">
                          <div>
                            <span>NOTICE</span>
                            <h2>{route.record ? '공지사항 상세' : '공지사항'}</h2>
                          </div>

                          <button type="button" className="survival-notice-page-back" onClick={() => route.record ? go({admin: false, tab: 'feed-notice', record: null}) : navigate('home')}>
                            {route.record ? '목록으로' : '홈으로'}
                          </button>
                        </header>

                        <NoticeFeed
                            selectedId={route.record}
                            onOpen={id => go({admin: false, tab: 'feed-notice', record: String(id)})}
                        />
                      </section>
                  ) : (
                      <section className="survival-card">
                        <h2>{feedTitles[view.slice(5)]}</h2>
                        <button type="button" onClick={() => navigate('home')}>홈으로 돌아가기</button>
                        {view === 'feed-event'
                            ? <p>등록된 이벤트가 없습니다.</p>
                            : <SystemFeed key={view} kind="activity" active={loggedIn}/>}
                      </section>
                  )
              )}

              {['world', 'system', 'schedule'].includes(view) && <GuidePage key={view} kind={view}/>}
              {view === 'roster' && <CharacterDirectory recordId={route.record} onOpen={record => go({admin: false, tab: 'roster', record})} onBack={() => go({admin: false, tab: 'roster'})} canReadDetails={loggedIn && !!user?.character_id}/>}
              {loggedIn && !user?.character_id && <CharacterCreationPanel/>}

              {loggedIn && user?.character_id && view === 'dice' && (
                  <section className="survival-card" aria-label="주사위">
                    <DicePanel expanded/>
                  </section>
              )}

              {loggedIn && user?.character_id && (
                  <>
                    <div className="survival-page" style={display('character')}>
                      <CharacterWorkspace
                          character={character}
                          inventory={inventory}
                          error={errors.character}
                          busy={busy}
                          run={run}
                          onCharacter={setCharacter}
                          refresh={refreshAll}
                          notify={setMessage}
                          dev={provider === 'dev'}
                      />
                    </div>

                    <div className="survival-page" style={display('battle')}>
                      <BattlePanel visible={view === 'battle'} inventory={inventory} busy={busy} run={run} refresh={refreshAll} revision={revision}/>
                    </div>

                    <div className="survival-page" style={display('records')}>
                      <RecordsPanel active={view==='records'}/>
                    </div>

                    <div className="survival-page" style={display('inventory')}>
                      <InventoryPanel character={character} inventory={inventory} storage={storage} cookingCatalog={cooking} errors={errors} busy={busy} run={run} refresh={refreshAll} notify={setMessage}/>
                    </div>

                    <div className="survival-page" style={display('investigation')}>
                      <InvestigationPanel activeBattle={character?.in_active_battle} battleError={errors.character} investigationApCost={investigationApCost} areas={areas} globalInvestigationRate={globalInvestigationRate} character={character} error={errors.areas} characterError={errors.character} busy={busy} run={run} refresh={refreshAll} notify={setMessage}/>
                    </div>

                    <div className="survival-page" style={display('shop')}>
                      <ShopPanel products={products} character={character} error={errors.products} busy={busy} run={run} refresh={refreshAll} notify={setMessage}/>
                    </div>

                    <div className="survival-page" style={display('cooking')}>
                      <CookingPanel activeBattle={character?.in_active_battle} battleError={errors.character} inventory={inventory} catalog={cooking} character={character} error={errors.cooking} busy={busy} run={run} refresh={refreshAll} notify={setMessage}/>
                    </div>

                    <div className="survival-page" style={display('gacha')}>
                      <GachaPanel gachas={gachas} character={character} error={errors.gachas} busy={busy} run={run} refresh={refreshAll} notify={setMessage}/>
                    </div>
                  </>
              )}
            </main>

            <nav className="survival-bottom-nav" aria-label="모바일 메뉴">
              {navigation
                  .filter(([id]) => loggedIn
                      ? ['home', 'character', 'investigation', 'battle'].includes(id)
                      : ['home', 'world', 'system', 'roster'].includes(id))
                  .map(([id, label, symbol]) => (
                      <button key={id} type="button" className={view === id ? 'is-active' : ''} onClick={() => navigate(id)}>
                        <NavIcon name={symbol} className="survival-nav-icon"/>
                        {label}
                      </button>
                  ))}

              <button type="button" data-sidebar-toggle aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
                <NavIcon name="menu" className="survival-nav-icon"/>
                더보기
              </button>
            </nav>
          </div>
        </div>
      </AnemiaPolicyContext.Provider>
  );
}