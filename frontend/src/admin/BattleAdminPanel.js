import RecipePicker from './RecipePicker';
import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import ItemPicker from './ItemPicker';

const emptyMonster = () => ({
  name: '',
  description: '',
  image_url: '',
  max_hp: 1,
  atk: 0,
  def: 0,
  agi: 0,
  is_active: false,
  areas: [],
  drops: [],
  actions: [
    {name: '일반공격', action_type: 'ATTACK', probability: 100, multiplier: 1, is_active: true, sort_order: 0}
  ]
});

const fields = ['name', 'description', 'image_url', 'max_hp', 'atk', 'def', 'agi', 'is_active'];

const cleanMonster = m => ({
  ...Object.fromEntries(fields.map(k => [k, m[k]])),
  areas: m.areas.map(a => ({
    area_id: String(a.area_id),
    weight: a.weight
  })),
  actions: m.actions.map(a => ({
    name: a.name,
    action_type: a.action_type,
    probability: Number(a.probability),
    multiplier: Number(a.multiplier),
    is_active: a.is_active,
    sort_order: a.sort_order,
    condition_type: a.condition_type ?? null,
    condition_value: a.condition_value ?? null
  })),
  drops: m.drops.map(d => ({
    item_id: d.item_id == null ? null : String(d.item_id),
    ...(d.recipe_id != null ? {recipe_id: String(d.recipe_id)} : {}),
    drop_rate: Number(d.drop_rate),
    min_quantity: d.min_quantity,
    max_quantity: d.max_quantity,
    is_ingredient: d.is_ingredient
  }))
});

export default function BattleAdminPanel({onDenied, recordId, onOpen}) {
  const [rows, setRows] = useState([]);
  const [areas, setAreas] = useState([]);
  const [draft, setDraft] = useState(emptyMonster);
  const [id, setId] = useState(null);
  const [original, setOriginal] = useState(null);
  const [settings, setSettings] = useState(null);
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

  async function reload() {
    const [m, a, s] = await Promise.all([
      api('/admin/monsters'),
      api('/admin/battle-areas'),
      api('/admin/battle-abilities')
    ]);

    setRows(m.records);
    setAreas(a.records);
    setSettings(s.settings);
  }

  useEffect(() => {
    work(reload);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!onOpen) return;

    let live = true;
    setId(null);
    setDraft(emptyMonster());
    setOriginal(null);

    if (recordId && recordId !== 'new') {
      setBusy(true);

      api('/admin/monsters/' + recordId)
          .then(data => {
            if (live) {
              setId(data.record.id);
              setDraft(cleanMonster(data.record));
              setOriginal(cleanMonster(data.record));
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

  const change = (key, value) => {
    setDraft(d => ({...d, [key]: value}));
  };

  const rowChange = (kind, index, key, value) => {
    setDraft(d => ({
      ...d,
      [kind]: d[kind].map((r, i) => i === index ? {...r, [key]: value} : r)
    }));
  };

  const remove = (kind, index) => {
    setDraft(d => ({
      ...d,
      [kind]: d[kind].filter((_, i) => i !== index)
    }));
  };

  const number = (label, value, onChange) => (
      <label>
        {label}
        <input type="number" min="0" step="any" required value={value} disabled={busy} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}/>
      </label>
  );

  async function saveMonster(e) {
    e.preventDefault();

    await work(async () => {
      const sum = draft.actions.filter(a => a.is_active).reduce((n, a) => n + Number(a.probability), 0);

      if (Math.abs(sum - 100) > 0.000001) {
        throw Error('활성 행동 확률 합계는 100%여야 합니다.');
      }

      if (!window.confirm('드롭을 포함한 마물 설정의 변경 전후를 확인하고 저장합니까?')) return;

      const saved = await api(`/admin/monsters${id ? `/${id}` : ''}`, {
        method: id ? 'PATCH' : 'POST',
        body: {...draft, requestKey: crypto.randomUUID()}
      });

      const fresh = await api(`/admin/monsters/${saved.record.id}`);

      setId(fresh.record.id);
      setDraft(cleanMonster(fresh.record));
      setOriginal(cleanMonster(fresh.record));

      await reload();
      setMessage('마물 저장 성공');
    });
  }

  async function deleteMonster() {
    await work(async () => {
      if (!window.confirm(`마물 ${id}을 영구 삭제합니까? 기존 전투 참조가 있으면 거부됩니다.`)) return;

      await api(`/admin/monsters/${id}`, {
        method: 'DELETE',
        body: {requestKey: crypto.randomUUID()}
      });

      setId(null);
      setDraft(emptyMonster());
      setOriginal(null);

      await reload();
      setMessage('마물 삭제 완료');
    });
  }

  function newMonster() {
    setId(null);
    setDraft(emptyMonster());
    setOriginal(null);
    onOpen?.('new');
  }

  function openMonster(record) {
    if (onOpen) {
      onOpen(String(record.id));
      return;
    }

    work(async () => {
      const data = await api(`/admin/monsters/${record.id}`);

      setId(record.id);
      setDraft(cleanMonster(data.record));
      setOriginal(cleanMonster(data.record));
    });
  }

  function changeDropType(index, type) {
    setDraft(old => ({
      ...old,
      drops: old.drops.map((r, n) => {
        if (n !== index) return r;

        if (type === 'recipe') {
          return {...r, item_id: null, recipe_id: '', min_quantity: 1, max_quantity: 1, is_ingredient: false};
        }

        return {item_id: '', drop_rate: r.drop_rate, min_quantity: 1, max_quantity: 1, is_ingredient: false};
      })
    }));
  }

  function addAction() {
    change('actions', [
      ...draft.actions,
      {name: '', action_type: 'ATTACK', probability: 0, multiplier: 1, is_active: true, sort_order: draft.actions.length}
    ]);
  }

  function addDrop() {
    change('drops', [
      ...draft.drops,
      {item_id: '', drop_rate: 100, min_quantity: 1, max_quantity: 1, is_ingredient: false}
    ]);
  }

  async function saveSettings(e) {
    e.preventDefault();

    await work(async () => {
      await api('/admin/battle-abilities', {
        method: 'PATCH',
        body: {settings, requestKey: crypto.randomUUID()}
      });

      await reload();
      setMessage('이능 설정 저장 성공');
    });
  }

  const actionProbability = draft.actions.filter(a => a.is_active).reduce((n, a) => n + Number(a.probability), 0);

  return (
      <section>
        <h2>일반 전투 운영 설정</h2>
        <p role="alert">{message}</p>
        <button disabled={busy} onClick={() => work(reload)}>새로고침</button>

        <details open>
          <summary>마물 등록·수정</summary>
          <button disabled={busy} onClick={newMonster}>새 마물</button>
          {id && <button disabled={busy} onClick={deleteMonster}>미참조 마물 영구 삭제</button>}

          <ul>
            {rows.map(r => (
                <li key={r.id}>
                  {r.name} · ID {r.id}
                  <span>
                                {' · 레시피: '}
                    {(r.recipe_drops || []).map(d => `${d.name} ${d.dropRate}%${d.discovered ? ' (발견 완료·드롭 제외)' : ''}`).join(', ') || '없음'}
                            </span>
                  <button disabled={busy} onClick={() => openMonster(r)}>상세/수정</button>
                </li>
            ))}
          </ul>

          {(!onOpen || recordId === 'new' || id) && (
              <form className="admin-form" onSubmit={saveMonster}>
                <h3>{id ? `마물 ${id} 수정` : '신규 마물'}</h3>

                {['name', 'description', 'image_url'].map(k => (
                    <label key={k}>
                      {{name: '이름', description: '설명', image_url: '이미지 URL'}[k]}
                      <input value={draft[k] ?? ''} required={k === 'name'} disabled={busy} onChange={e => change(k, e.target.value)}/>
                    </label>
                ))}

                {['max_hp', 'atk', 'def', 'agi'].map(k => (
                    <div key={k}>{number(k, draft[k], v => change(k, v))}</div>
                ))}

                <label>
                  활성
                  <input type="checkbox" checked={draft.is_active} disabled={busy} onChange={e => change('is_active', e.target.checked)}/>
                </label>

                <h3>출현 지역</h3>
                {draft.areas.map((a, i) => (
                    <fieldset key={i}>
                      <label>
                        지역
                        <select value={a.area_id} disabled={busy} onChange={e => rowChange('areas', i, 'area_id', e.target.value)} required>
                          <option value="">지역 선택</option>
                          {areas.map(r => <option key={r.id} value={r.id}>{r.name} · ID {r.id}</option>)}
                        </select>
                      </label>
                      {number('출현 가중치', a.weight, v => rowChange('areas', i, 'weight', v))}
                      <button type="button" disabled={busy} onClick={() => remove('areas', i)}>지역 제거</button>
                    </fieldset>
                ))}
                <button type="button" disabled={busy} onClick={() => change('areas', [...draft.areas, {area_id: '', weight: 1}])}>지역 추가</button>

                <h3>마물 행동</h3>
                {draft.actions.map((a, i) => (
                    <fieldset key={i}>
                      <label>
                        행동명
                        <input value={a.name} required disabled={busy} onChange={e => rowChange('actions', i, 'name', e.target.value)}/>
                      </label>
                      <label>
                        행동 종류
                        <select value={a.action_type} disabled={busy} onChange={e => rowChange('actions', i, 'action_type', e.target.value)}>
                          {['ATTACK', 'SPECIAL_ATTACK', 'FLEE'].map(v => <option key={v}>{v}</option>)}
                        </select>
                      </label>
                      {number('확률 %', a.probability, v => rowChange('actions', i, 'probability', v))}
                      {number('공격 배율', a.multiplier, v => rowChange('actions', i, 'multiplier', v))}
                      <label>
                        사용
                        <input type="checkbox" checked={a.is_active} disabled={busy} onChange={e => rowChange('actions', i, 'is_active', e.target.checked)}/>
                      </label>
                      {a.condition_type && <p>조건부 행동 {a.condition_type}: 수정 HOLD</p>}
                      <button type="button" disabled={busy} onClick={() => remove('actions', i)}>행동 제거</button>
                    </fieldset>
                ))}
                <button type="button" disabled={busy} onClick={addAction}>행동 추가</button>
                <p>활성 확률 합계: {actionProbability}%</p>

                <h3>드롭</h3>
                {draft.drops.map((d, i) => (
                    <fieldset key={i}>
                      <label>
                        드롭 대상 종류
                        <select disabled={busy} value={d.recipe_id != null ? 'recipe' : 'item'} onChange={e => changeDropType(i, e.target.value)}>
                          <option value="item">아이템·식재료</option>
                          <option value="recipe">레시피</option>
                        </select>
                      </label>

                      {d.recipe_id != null ? (
                          <RecipePicker label="드롭 레시피" value={d.recipe_id} disabled={busy} onDenied={onDenied} onChange={v => rowChange('drops', i, 'recipe_id', v)}/>
                      ) : (
                          <ItemPicker label="드롭 아이템" value={d.item_id} disabled={busy} onDenied={onDenied} onChange={v => rowChange('drops', i, 'item_id', v)}/>
                      )}

                      {number('드롭 확률 %', d.drop_rate, v => rowChange('drops', i, 'drop_rate', v))}
                      {d.recipe_id == null && number('최소 수량', d.min_quantity, v => rowChange('drops', i, 'min_quantity', v))}
                      {d.recipe_id == null && number('최대 수량', d.max_quantity, v => rowChange('drops', i, 'max_quantity', v))}

                      <label>
                        식재료
                        <input type="checkbox" checked={d.is_ingredient} disabled={busy || d.recipe_id != null} onChange={e => rowChange('drops', i, 'is_ingredient', e.target.checked)}/>
                      </label>
                      <button type="button" disabled={busy} onClick={() => remove('drops', i)}>드롭 제거</button>
                    </fieldset>
                ))}
                <button type="button" disabled={busy} onClick={addDrop}>드롭 추가</button>

                <details className="admin-wide">
                  <summary>변경 전후 비교</summary>
                  <pre>{JSON.stringify({before: original, after: draft}, null, 2)}</pre>
                </details>

                <p>최초 발견된 레시피는 실제 전투 보상 후보에서 제외됩니다.</p>
                <button disabled={busy}>마물 저장</button>
              </form>
          )}
        </details>

        <details>
          <summary>이능관리등급 배율·AP 비용</summary>
          {settings && (
              <form className="admin-form" onSubmit={saveSettings}>
                {Object.entries(settings).map(([k, v]) => (
                    <div key={k}>{number(k, v, value => setSettings(s => ({...s, [k]: value})))}</div>
                ))}
                <button disabled={busy}>이능 설정 저장</button>
              </form>
          )}
        </details>

        <p>캐릭터는 Mastodon 로그인 시 자동 연결됩니다. 초기 능력치는 캐릭터 운영 관리에서 설정하세요.</p>
      </section>
  );
}