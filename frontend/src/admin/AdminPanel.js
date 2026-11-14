import ContentAdminPanel from './ContentAdminPanel';
import StorageAdminPanel from './StorageAdminPanel';
import ClueAdminPanel from './ClueAdminPanel';
import {useCallback, useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import {adminMenus} from './navigation';
import './admin.css';
import OperatingPolicyPanel from './OperatingPolicyPanel';
import DiagnosticsPanel from './DiagnosticsPanel';
import MasterPanel from './MasterPanel';
import RolePanel from './RolePanel';
import RecordsPanel from '../dev/RecordsPanel';
import BattleAdminPanel from './BattleAdminPanel';
import ItemPicker from './ItemPicker';
import BalancePanel from './BalancePanel';
import CharacterOperationsPanel from './CharacterOperationsPanel';
import InvestigationAdminPanel from './InvestigationAdminPanel';
import ImageUploadField from './ImageUploadField';

const emptyItem = {
  name: '',
  category: 'ETC',
  description: null,
  image_url: null,
  transferable: true,
  is_active: true,
  effect_type: null,
  blood_pack_kind: null,
  effect_value: null,
  usable: false,
  use_target: 'NONE',
  battle_usable: false
};

const emptyProduct = {
  item_id: '',
  price: 0,
  purchase_limit: null,
  stock_limit: null,
  daily_limit: null,
  is_active: true,
  sort_order: 0
};

const fieldLabels = {
  name: '이름',
  category: '종류',
  description: '설명',
  transferable: '이동 가능',
  is_active: '활성',
  item_id: '판매 아이템 ID',
  price: '가격',
  purchase_limit: '개인 누적 한도',
  stock_limit: '전체 누적 재고 한도',
  sort_order: '표시 순서',
  daily_limit: '일일 구매 한도',
  effect_type: '효과',
  blood_pack_kind: '혈액팩 종류',
  battle_usable: '전투 사용 가능',
  effect_value: '효과 수치',
  usable: '사용 가능',
  use_target: '사용 대상'
};

function Editor({kind, record, seed, onSaved, onDenied}) {
  const fields = kind === 'items' ? emptyItem : emptyProduct;
  const [draft, setDraft] = useState(() => Object.fromEntries(
      Object.keys(fields).map(key => [key, record?.[key] ?? seed?.[key] ?? fields[key]])
  ));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const saving = useRef(false);
  const [imageUploading,setImageUploading]=useState(false);

  function change(key, value) {
    setDraft(current => ({...current, [key]: value}));
  }

  async function submit(event) {
    event.preventDefault();
    if (saving.current || imageUploading) return;

    saving.current = true;
    setBusy(true);
    setMessage('');

    try {
      const {record: saved} = await api(`/admin/${kind}${record ? `/${record.id}` : ''}`, {
        method: record ? 'PATCH' : 'POST',
        body: {...draft, requestKey: crypto.randomUUID()}
      });

      setMessage('저장 성공');
      onSaved(saved);
    } catch (e) {
      setMessage(`${e.code || 'SAVE_FAILED'}: ${e.message}`);
      if (e.status === 401 || e.status === 403) onDenied(e.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function changeEffectType(value) {
    setDraft({
      ...draft,
      effect_type: value || null,
      blood_pack_kind: value ? 'STANDARD' : null,
      effect_value: value ? 30 : null,
      usable: !!value,
      use_target: value ? 'SELF' : 'NONE',
      category: value ? 'CONSUMABLE' : draft.category,
      battle_usable: !!value,
      transferable: true
    });
  }

  function changeBloodPackKind(value) {
    setDraft({
      ...draft,
      blood_pack_kind: value || null,
      effect_value: value === 'FREE' ? 10 : value === 'STANDARD' ? 30 : null
    });
  }

  function changeLimit(key, unlimited) {
    change(key, unlimited ? null : ['purchase_limit', 'daily_limit'].includes(key) ? 1 : 0);
  }

  function renderField(key) {
    if (key==='image_url') {
      return <ImageUploadField key={key} kind="items" label="아이템 이미지"
                               value={draft.image_url} onChange={value=>change('image_url',value)}
                               disabled={busy} onDenied={onDenied}
                               onUploadingChange={setImageUploading}/>;
    }

    let input;

    if (typeof fields[key] === 'boolean') {
      input = <input type="checkbox" checked={draft[key]} disabled={busy} onChange={e => change(key, e.target.checked)}/>;
    } else if (key === 'effect_type') {
      input = (
          <select value={draft[key] ?? ''} disabled={busy} onChange={e => changeEffectType(e.target.value)}>
            <option value="">없음</option>
            <option value="BLOOD_PACK">혈액팩</option>
          </select>
      );
    } else if (key === 'blood_pack_kind') {
      input = (
          <select value={draft[key] ?? ''} disabled={busy || draft.effect_type !== 'BLOOD_PACK'} onChange={e => changeBloodPackKind(e.target.value)}>
            <option value="">선택</option>
            <option value="FREE">무료 혈액팩 (+10, 하루 1개)</option>
            <option value="STANDARD">일반 혈액팩 (+30, 유료)</option>
          </select>
      );
    } else if (key === 'effect_value') {
      input = <input type="number" min="1" value={draft[key] ?? ''} disabled={busy} onChange={e => change(key, e.target.value === '' ? null : Number(e.target.value))}/>;
    } else if (key === 'use_target') {
      input = <input value={draft[key] ?? ''} readOnly/>;
    } else if (key === 'category') {
      input = (
          <select value={draft[key]} disabled={busy} onChange={e => change(key, e.target.value)}>
            {['MATERIAL', 'CONSUMABLE', 'FOOD', 'ETC'].map(v => <option key={v}>{v}</option>)}
          </select>
      );
    } else if (key === 'description') {
      input = <textarea value={draft[key] ?? ''} disabled={busy} onChange={e => change(key, e.target.value || null)}/>;
    } else if (['purchase_limit', 'stock_limit', 'daily_limit'].includes(key)) {
      input = (
          <>
            <span>
              <input type="checkbox" checked={draft[key] === null} disabled={busy} onChange={e => changeLimit(key, e.target.checked)}/>
              무제한(NULL)
            </span>
            <input type="number" min={key === 'purchase_limit' ? 1 : 0} max={2147483647} value={draft[key] ?? ''}
                   disabled={busy || draft[key] === null} required={draft[key] !== null}
                   onChange={e => change(key, e.target.value === '' ? '' : Number(e.target.value))}/>
          </>
      );
    } else {
      input = (
          <input type={['price', 'sort_order'].includes(key) ? 'number' : 'text'} value={draft[key]} required disabled={busy}
                 maxLength={key === 'name' ? 100 : undefined}
                 onChange={e => change(key, ['price', 'sort_order'].includes(key) ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}/>
      );
    }

    return <label key={key}>{fieldLabels[key]}{input}</label>;
  }

  return (
      <form className="admin-form" onSubmit={submit}>
        <h3>{record ? `ID ${record.id} 수정` : '새로 등록'}</h3>
        {Object.keys(fields).map(renderField)}

        {record && (
            <details>
              <summary>변경 전후 확인</summary>
              <pre>{JSON.stringify({before: record, after: draft}, null, 2)}</pre>
            </details>
        )}

        <button disabled={busy || imageUploading}>
          {imageUploading ? '이미지 업로드 중…' : busy ? '저장 중…' : '저장'}
        </button>
        <p role="status">{message}</p>
      </form>
  );
}

export default function AdminPanel({onBack, onExit = onBack, onLogout, onAccessLost, route, onNavigate}) {
  const [authentication, setAuthentication] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [localKind, setLocalKind] = useState('items');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editorKey, setEditorKey] = useState(0);
  const [message, setMessage] = useState('권한 확인 중…');
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState(null);
  const [productSeed, setProductSeed] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const selectionRequest = useRef(0);
  const listRequest = useRef(0);
  const accessLost = useRef(onAccessLost);
  accessLost.current = onAccessLost;

  const kind = route?.menu || localKind;
  const recordId = route?.record;

  function setKind(menu) {
    setSearch('');
    setSelected(null);
    setProductSeed(null);
    setEditorKey(v => v + 1);

    if (onNavigate) {
      onNavigate({menu, record: null, after: null, area: null});
    } else {
      setLocalKind(menu);
    }
  }

  function openRecord(record) {
    onNavigate?.({record});
  }

  const denied = useCallback(message => {
    selectionRequest.current++;
    listRequest.current++;
    setAllowed(false);
    setRows([]);
    setSelected(null);
    setMessage(message);
    accessLost.current?.();
  }, []);

  async function load(type = kind, after = route?.after || null) {
    const request = ++listRequest.current;

    setBusy(true);
    setMessage('');

    try {
      const data = await api(`/admin/${type}${after ? `?after=${after}` : ''}`);
      if (request !== listRequest.current) return false;

      setRows(data.records);
      setNext(data.nextAfter);
      return true;
    } catch (e) {
      setMessage(`${e.code || 'LOAD_FAILED'}: ${e.message}`);
      if (e.status === 401 || e.status === 403) denied(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let live = true;

    const verify = () => api('/admin/access')
        .then(data => {
          if (live) {
            if (data.role !== 'ADMIN') throw new Error('관리자 권한이 필요합니다.');
            setAuthentication(data.authentication || 'DEV');
            setAllowed(true);
          }
        })
        .catch(e => {
          if (live) denied(`${e.code || 'ACCESS_FAILED'}: ${e.message}`);
        });

    verify();
    window.addEventListener('focus', verify);
    const timer = window.setInterval(verify, 30000);

    return () => {
      live = false;
      window.removeEventListener('focus', verify);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    selectionRequest.current++;
    if (!allowed) return;

    setSelected(null);
    setEditorKey(v => v + 1);
    setMessage('');

    if (['items', 'products'].includes(kind)) {
      load(kind, route?.after);
      if (recordId && recordId !== 'new') select({id: recordId}, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, kind, recordId, route?.after]);

  async function select(row, navigate = true) {
    if (onNavigate && navigate) {
      openRecord(String(row.id));
      return;
    }

    const request = ++selectionRequest.current;
    setBusy(true);

    try {
      const data = await api(`/admin/${kind}/${row.id}`);
      if (request !== selectionRequest.current) return;

      setSelected(data.record);
      setEditorKey(v => v + 1);
    } catch (e) {
      setMessage(e.message);
      if (e.status === 401 || e.status === 403) denied(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem() {
    if (!window.confirm(`아이템 ${selected.name} (ID ${selected.id})을 영구 삭제합니까? 참조가 있으면 거부됩니다.`)) return;

    setBusy(true);

    try {
      await api(`/admin/items/${selected.id}`, {
        method: 'DELETE',
        body: {requestKey: crypto.randomUUID()}
      });

      setSelected(null);
      setEditorKey(v => v + 1);
      await load();
      setMessage('삭제 완료');
    } catch (e) {
      setMessage(`${e.code || 'DELETE_FAILED'}: ${e.message}`);
      if ([401, 403].includes(e.status)) denied(e.message);
    } finally {
      setBusy(false);
    }
  }

  function registerProduct() {
    setProductSeed({
      item_id: String(selected.id),
      price: 0,
      daily_limit: selected.blood_pack_kind === 'FREE' ? 1 : null
    });

    if (onNavigate) {
      onNavigate({menu: 'products', record: 'new'});
    } else {
      setLocalKind('products');
    }

    setSelected(null);
    setEditorKey(v => v + 1);
    if (!route) load('products');
  }

  function createRecord() {
    setSelected(null);
    setProductSeed(null);
    setEditorKey(v => v + 1);
    openRecord('new');
  }

  function handleSubmitCapture(e) {
    const submitter = e.nativeEvent.submitter || e.target.querySelector('button:not([type="button"])');
    const text = submitter?.textContent || '';

    if (/저장|등록|수정|적용/.test(text) && !window.confirm('변경 내용을 저장하시겠습니까?')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function handleSaved(saved) {
    setProductSeed(null);
    setSelected(saved);
    setEditorKey(v => v + 1);

    load().then(ok => {
      if (ok) setMessage('저장 성공');
    });
  }

  function renderContent() {
    if (kind === 'dashboard') {
      return (
          <div className="admin-dashboard">
            {adminMenus.filter(([id]) => id !== 'dashboard').map(([id, label]) => (
                <button key={id} onClick={() => setKind(id)}>
                  <strong>{label}</strong>
                  <span>조회 및 관리 →</span>
                </button>
            ))}
          </div>
      );
    }

    if (kind.startsWith('guide-')) return <ContentAdminPanel key={kind} kind={kind.slice(6)} onDenied={denied}/>;
    if (kind === 'storage') return <StorageAdminPanel onDenied={denied}/>;
    if (kind === 'clues') return <ClueAdminPanel onDenied={denied} recordId={recordId} onOpen={onNavigate ? openRecord : undefined}/>;
    if (kind === 'policies') return <OperatingPolicyPanel onDenied={denied}/>;
    if (kind === 'diagnostics') return <DiagnosticsPanel onDenied={denied}/>;
    if (kind === 'investigation') return <InvestigationAdminPanel onDenied={denied} route={route} onNavigate={onNavigate}/>;
    if (kind === 'characters') return <CharacterOperationsPanel onDenied={denied} recordId={recordId} onOpen={onNavigate ? openRecord : undefined}/>;
    if (kind === 'balance') return <BalancePanel onDenied={denied}/>;
    if (kind === 'logs') return <RecordsPanel admin onDenied={denied}/>;
    if (kind === 'battle') return <BattleAdminPanel onDenied={denied} recordId={recordId} onOpen={onNavigate ? openRecord : undefined}/>;
    if (kind === 'users') return <RolePanel onDenied={denied}/>;

    if (['foods', 'food-grades', 'recipes', 'gachas', 'areas'].includes(kind)) {
      return (
          <MasterPanel key={kind} kind={kind} onDenied={denied} recordId={recordId} onOpen={onNavigate ? openRecord : undefined} after={route?.after} onPage={onNavigate ? after => onNavigate({after, record: null}) : undefined}/>
      );
    }

    return (
        <>
          <p>혈액팩은 무료(+10, 0코인, 하루 1개)와 일반(+30, 유료)을 별도 아이템으로 관리합니다. 일반팩 가격은 운영진이 정합니다. 기록은 보존합니다.</p>

          {kind === 'items' && selected && (
              <>
                <button disabled={busy} onClick={deleteItem}>미참조 아이템 영구 삭제</button>
                <button disabled={busy} onClick={registerProduct}>이 아이템을 상점에 등록</button>
              </>
          )}

          {kind === 'products' && <p>상점 상품 설정은 다음 구매부터 적용됩니다. 기존 구매 이력은 유지됩니다.</p>}

          <button disabled={busy} onClick={createRecord}>새로 등록</button>
          <button disabled={busy} onClick={() => load()}>목록 새로고침</button>

          <div className="admin-toolbar">
            <label>
              현재 페이지 검색
              <input value={search} onChange={e => setSearch(e.target.value)}/>
            </label>
            <label>
              상태
              <select value={filter} onChange={e => setFilter(e.target.value)}>
                <option value="all">전체</option>
                <option value="active">활성</option>
                <option value="inactive">비활성</option>
              </select>
            </label>
          </div>

          {busy && <p role="status">불러오는 중…</p>}
          {!busy && !rows.length && <p>등록된 데이터가 없습니다.</p>}

          <ul className="admin-records">
            {rows.filter(row => (
                (filter === 'all' || row.is_active === (filter === 'active')) &&
                [row.id, row.name, row.item_id].join(' ').toLowerCase().includes(search.toLowerCase())
            )).map(row => (
                <li key={row.id}>
                  ID {row.id} · {row.name || `아이템 ${row.item_id} / 가격 ${row.price}`} · {row.is_active ? '활성' : '비활성'}
                  <button disabled={busy} onClick={() => select(row)}>상세/수정</button>
                </li>
            ))}
          </ul>

          {route?.after && (
              <button disabled={busy} onClick={() => onNavigate({after: null, record: null})}>처음 페이지</button>
          )}

          {next && (
              <button disabled={busy} onClick={() => onNavigate ? onNavigate({after: next, record: null}) : load(kind, next)}>다음 100건</button>
          )}

          {(!route || recordId === 'new' || selected) && !busy && (
              <Editor key={`${kind}-${editorKey}`} kind={kind} record={selected} seed={kind === 'products' ? productSeed : null} onDenied={denied} onSaved={handleSaved}/>
          )}
        </>
    );
  }

  return (
      <section className="admin-panel" onSubmitCapture={handleSubmitCapture}>
        <header className="admin-heading">
          <div>
            <small>생존밥 · 운영 관리</small>
            <h1>관리자</h1>
          </div>
          <div className="actions">
            <button onClick={onBack}>뒤로가기</button>
            <button onClick={onExit}>게임으로 돌아가기</button>
            {onLogout && <button onClick={onLogout}>로그아웃</button>}
          </div>
        </header>

        <p>서버 ADMIN 권한 검증 영역입니다. 인증 방식: {authentication || '확인 중'}</p>
        <p role="alert">{message}</p>

        {allowed && (
            <>
              <nav className="admin-navigation" aria-label="관리자 메뉴">
                {adminMenus.map(([type, label]) => (
                    <button key={type} aria-current={kind === type ? 'page' : undefined} disabled={busy} onClick={() => setKind(type)}>{label}</button>
                ))}
              </nav>

              <div className="admin-content">
                <h2>{adminMenus.find(([id]) => id === kind)?.[1]}</h2>
                {recordId && <button disabled={busy} onClick={() => onNavigate({record: null})}>편집 취소 · 목록으로</button>}
                {renderContent()}
              </div>
            </>
        )}
      </section>
  );
}
