import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import ItemPicker from './ItemPicker';

const emptyMonster = () => ({
  name: '', description: '', image_url: '',
  max_hp: 1, atk: 0, def: 0, agi: 0, is_active: false,
  areas: [], drops: [],
  actions: [
    {name: '일반공격', action_type: 'ATTACK', probability: 100, multiplier: 1, is_active: true, sort_order: 0}
  ]
});

const fields = ['name', 'description', 'image_url', 'max_hp', 'atk', 'def', 'agi', 'is_active'];

const cleanMonster = m => ({
  ...Object.fromEntries(fields.map(k => [k, m[k]])),
  areas: m.areas.map(a => ({
    area_id: String(a.area_id), weight: a.weight
  })),
  actions: m.actions.map(a => ({
    name: a.name, action_type: a.action_type,
    probability: Number(a.probability), multiplier: Number(a.multiplier),
    is_active: a.is_active, sort_order: a.sort_order,
    condition_type: a.condition_type ?? null, condition_value: a.condition_value ?? null
  })),
  drops: m.drops.filter(d=>d.item_id!=null).map(d => ({
    item_id: String(d.item_id), drop_rate: Number(d.drop_rate),
    min_quantity: d.min_quantity, max_quantity: d.max_quantity,
    ingredient_role: d.ingredient_role ?? null,
    is_ingredient: d.ingredient_role != null
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

      // 마물당 출현 지역은 최대 한 곳만 허용한다.
      if (draft.areas.length > 1) {
        throw Error('마물은 한 구역에만 배치할 수 있습니다.');
      }

      const baseCount=draft.drops.filter(d=>d.ingredient_role==='BASE').length;
      const bonusTotal=draft.drops.filter(d=>d.ingredient_role==='BONUS').reduce((n,d)=>n+Number(d.drop_rate),0);

      if (draft.is_active && baseCount!==1) {
        throw Error('활성 마물은 기본 식재료를 정확히 하나 등록해야 합니다.');
      }
      if (baseCount>1) {
        throw Error('기본 식재료는 하나만 등록할 수 있습니다.');
      }
      if (bonusTotal>100.000001) {
        throw Error('추가 식재료의 확률 합계는 100% 이하여야 합니다.');
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

  function changeDropRole(index,role) {
    setDraft(old => ({
      ...old,
      drops: old.drops.map((r, n) => {
        if (n !== index) return r;
        return {
          ...r,
          ingredient_role:role,
          is_ingredient:role!==null,
          drop_rate:role==='BASE'?100:r.drop_rate,
          min_quantity:role!==null?1:r.min_quantity,
          max_quantity:role!==null?1:r.max_quantity
        };
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
      {item_id: '', drop_rate: 100, min_quantity: 1, max_quantity: 1, is_ingredient: false, ingredient_role: null}
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
  const bonusProbability = draft.drops.filter(d=>d.ingredient_role==='BONUS').reduce((n,d)=>n+Number(d.drop_rate||0),0);

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
                  <span> · 기본 식재료: {r.base_ingredient_name||'미설정'}</span>
                  <span> · 추가 식재료: {(r.bonus_ingredients||[]).map(d=>`${d.name} ${d.dropRate}%`).join(', ')||'없음'}</span>
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
                <button type="button" disabled={busy || draft.areas.length >= 1} onClick={() => change('areas', [...draft.areas, {area_id: '', weight: 1}])}>지역 추가</button>

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

                <h3>마물 보상</h3>
                <p>기본 식재료는 1개 확정 지급합니다. 추가 식재료는 확률 합계 100% 이내에서 최대 1개만 지급하며, 일반 아이템은 별도로 추첨합니다.</p>

                {draft.drops.map((d, i) => (
                    <fieldset key={i}>
                      <legend>보상 {i+1}</legend>
                      <label>
                        보상 구분
                        <select disabled={busy} value={d.ingredient_role??'ITEM'} onChange={e=>changeDropRole(i,e.target.value==='ITEM'?null:e.target.value)}>
                          <option value="ITEM">일반 아이템</option>
                          <option value="BASE">기본 식재료 (1개 확정)</option>
                          <option value="BONUS">추가 식재료 (확률 지급)</option>
                        </select>
                      </label>

                      <ItemPicker label={d.ingredient_role?'식재료':'드롭 아이템'} value={d.item_id} disabled={busy} onDenied={onDenied} onChange={v=>rowChange('drops',i,'item_id',v)}/>

                      {d.ingredient_role==='BASE'?
                          <p>지급 확률: 100% 확정 · 수량: 1개</p>:
                          number(d.ingredient_role==='BONUS'?'추가 지급 확률 (%)':'드롭 확률 (%)',d.drop_rate,v=>rowChange('drops',i,'drop_rate',v))
                      }

                      {d.ingredient_role===null?<>
                        {number('최소 수량',d.min_quantity,v=>rowChange('drops',i,'min_quantity',v))}
                        {number('최대 수량',d.max_quantity,v=>rowChange('drops',i,'max_quantity',v))}
                      </>:d.ingredient_role==='BONUS'&&<p>지급 수량: 1개</p>}

                      <button type="button" disabled={busy} onClick={() => remove('drops', i)}>보상 제거</button>
                    </fieldset>
                ))}
                <button type="button" disabled={busy} onClick={addDrop}>보상 추가</button>
                <p>추가 식재료 확률 합계: {bonusProbability}% (최대 100%)</p>

                <details className="admin-wide">
                  <summary>변경 전후 비교</summary>
                  <pre>{JSON.stringify({before: original, after: draft}, null, 2)}</pre>
                </details>

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