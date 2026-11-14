import InitialCharacterSettings from './InitialCharacterSettings';
import CharacterDetailsEditor from './CharacterDetailsEditor';
import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import ItemPicker from './ItemPicker';

const fields = {
  hp: 'HP',
  blood: '혈량',
  ap: 'AP',
  currency: '재화',
  atk: 'ATK',
  def: 'DEF',
  agi: 'AGI'
};

export default function CharacterOperationsPanel({onDenied, recordId, onOpen}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef(false);

  async function work(fn) {
    if (pending.current) return;

    pending.current = true;
    setBusy(true);
    setMessage('');

    try {
      await fn();
    } catch (e) {
      setMessage(`${e.code || 'ERROR'}: ${e.message}`);
      if ([401, 403].includes(e.status)) onDenied(e.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function search(after = null) {
    const r = await api(`/admin/characters?q=${encodeURIComponent(query)}${after ? `&after=${after}` : ''}`);
    setRows(r.records);
    setNext(r.nextAfter);
  }

  async function select(id) {
    const r = await api(`/admin/characters/${id}`);
    setData(r);
    setDraft(Object.fromEntries(Object.keys(fields).map(k => [k, Number(r.character[k])])));
  }

  useEffect(() => {
    if (!onOpen) return;

    let live = true;
    setData(null);

    if (recordId && recordId !== 'new') {
      setBusy(true);

      api('/admin/characters/' + recordId)
          .then(r => {
            if (live) {
              setData(r);
              setDraft(Object.fromEntries(Object.keys(fields).map(k => [k, Number(r.character[k])])));
            }
          })
          .catch(e => {
            if (live) {
              setMessage(e.message);
              if ([401, 403].includes(e.status)) onDenied(e.message);
            }
          })
          .finally(() => {
            if (live) setBusy(false);
          });
    }

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  async function save(inventory) {
    if (!window.confirm(`${data.character.name} (ID ${data.character.id})의 ${inventory ? '아이템 보유량' : '자원·능력치'}을 수정합니까?`)) return;

    await api(`/admin/characters/${data.character.id}${inventory ? '/inventory' : ''}`, {
      method: 'PATCH',
      body: {
        ...(inventory ? {itemId, quantity} : draft),
        requestKey: crypto.randomUUID()
      }
    });

    await select(data.character.id);
    setMessage('저장 성공');
  }

  function searchSubmit(e) {
    e.preventDefault();
    work(() => search());
  }

  function saveCharacter(e) {
    e.preventDefault();
    work(() => save(false));
  }

  function saveInventory(e) {
    e.preventDefault();
    work(() => save(true));
  }

  return (
      <section>
        <h2>캐릭터 운영 관리</h2>
        <p>상태는 HP·혈량 변경에 따라 공용 규칙으로 결정합니다. 사망 강제 복구·최초 발견 이력 취소는 지원하지 않으며, ACTIVE 전투 중에는 수정할 수 없습니다.</p>

        <form onSubmit={searchSubmit}>
          <label>
            캐릭터 이름
            <input value={query} maxLength={100} disabled={busy} onChange={e => setQuery(e.target.value)}/>
          </label>
          <button disabled={busy}>캐릭터 검색</button>
        </form>

        <p>빈 검색어로 등록된 러너·캐릭터를 조회할 수 있습니다. 계정 권한과 게임 초기 설정은 별개입니다.</p>
        <p role="alert">{message}</p>

        <ul>
          {rows.map(r => (
              <li key={r.id}>
                {r.profile_image_url && (
                    <img src={r.profile_image_url} width="40" height="40" alt="" loading="lazy" onError={e => {e.currentTarget.hidden = true;}}/>
                )}
                {r.name} · ID {r.id} · {r.status} ·
                {r.user_id ? ` 러너 계정 ${r.user_id} (${r.user_role === 'ADMIN' ? '관리자' : '일반 러너'})` : ' 연결 계정 없음'} ·
                {r.initial_setup_complete === false ? ' 초기 설정 미완료' : ' 초기 설정 완료'} ·
                헌터 {r.hunter_grade ?? '미설정'} ·
                이능 {r.initial_setup_complete === false ? '미설정' : r.has_ability ? r.ability_grade : '없음'} ·
                {r.is_active ? '활성' : '비활성'}
                <button disabled={busy} onClick={() => onOpen ? onOpen(String(r.id)) : work(() => select(r.id))}>선택</button>
              </li>
          ))}
        </ul>

        {next && <button disabled={busy} onClick={() => work(() => search(next))}>다음 50건</button>}

        {data && (
            <>
              <h3>{data.character.name} · {data.character.status}</h3>
              <p>사망 {data.character.death_count}회 · 부활 {data.character.revive_count}회</p>

              {data.character.initial_setup_complete === false ? (
                  <InitialCharacterSettings key={data.character.id} character={data.character} onDenied={onDenied} onSaved={() => select(data.character.id)}/>
              ) : (
                  <>
                    <form className="admin-form" onSubmit={saveCharacter}>
                      {Object.entries(fields).map(([k, label]) => (
                          <label key={k}>
                            {label}
                            <input required type="number" min="0" step="1" value={draft[k]} disabled={busy} onChange={e => setDraft({...draft, [k]: e.target.value === '' ? '' : Number(e.target.value)})}/>
                          </label>
                      ))}
                      <button disabled={busy}>캐릭터 저장</button>
                    </form>

                    <CharacterDetailsEditor key={data.character.id} id={data.character.id} onDenied={onDenied} onSaved={() => select(data.character.id)}/>
                  </>
              )}

              <h3>보유 아이템</h3>
              <ul>
                {data.inventory.map(r => (
                    <li key={r.item_id}>
                      {r.name} · ID {r.item_id} · {r.quantity}개
                      <button disabled={busy} onClick={() => {setItemId(String(r.item_id)); setQuantity(r.quantity);}}>수량 선택</button>
                    </li>
                ))}
              </ul>

              <form className="admin-form" onSubmit={saveInventory}>
                <ItemPicker value={itemId} onChange={setItemId} disabled={busy} onDenied={onDenied}/>
                <label>
                  최종 보유 수량
                  <input required type="number" min="0" step="1" value={quantity} disabled={busy} onChange={e => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}/>
                </label>
                <button disabled={busy || !itemId}>보유량 저장</button>
              </form>
            </>
        )}
      </section>
  );
}