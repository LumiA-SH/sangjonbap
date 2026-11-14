import {useRef, useState} from 'react';
import {api} from '../api/client';
import ItemPicker from './ItemPicker';

export default function GachaStockEditor({record, onSaved, onDenied, onBusy}) {
  const [draft, setDraft] = useState(() => ({
    name: record?.name || '',
    price: 1,
    is_active: record?.is_active ?? false,
    start_at: record?.start_at ?? null,
    end_at: record?.end_at ?? null,
    rewards: (record?.rewards || []).map(r => ({...r, quantity: 1}))
  }));

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const sending = useRef(false);

  const rows = draft.rewards;
  const total = rows.filter(r => r.is_active !== false).reduce((sum, r) => sum + (Number(r.remaining_stock) || 0), 0);
  const filtered = rows.map((row, index) => ({row, index})).filter(({row}) => `${row.name || ''} ${row.item_id}`.toLowerCase().includes(query.toLowerCase()));

  function change(index, patch) {
    setDraft(d => ({
      ...d,
      rewards: d.rewards.map((r, i) => i === index ? {...r, ...patch} : r)
    }));
  }

  async function save(e) {
    e.preventDefault();
    if (sending.current) return;

    if (new Set(rows.map(r => r.item_id)).size !== rows.length) {
      setMessage('아이템 중복 등록은 불가합니다.');
      return;
    }

    if (rows.some(r => (r.max_stock == null || r.remaining_stock == null) && r.is_active !== false)) {
      setMessage('재고 미확정 항목은 전환 HOLD입니다. 행 제외로 비활성화할 수 있습니다.');
      return;
    }

    sending.current = true;
    setBusy(true);
    onBusy(true);
    setMessage('');

    try {
      const body = {
        ...draft,
        rewards: rows.map(r => ({
          item_id: String(r.item_id),
          quantity: 1,
          is_active: r.is_active !== false,
          max_stock: r.max_stock,
          remaining_stock: r.remaining_stock
        })),
        requestKey: crypto.randomUUID()
      };

      const saved = await api(`/admin/gachas${record ? `/${record.id}` : ''}`, {
        method: record ? 'PATCH' : 'POST',
        body
      });

      await onSaved(saved.record);
    } catch (e) {
      setMessage(`${e.code || 'SAVE_FAILED'}: ${e.message}`);
      if ([401, 403].includes(e.status)) onDenied(e.message);
    } finally {
      sending.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  return (
      <form className="admin-form" onSubmit={save}>
        <h3>{record ? `가챠 ${record.id} 수정` : '가챠 등록'}</h3>
        <p>1회 코인 1개 · RP 아이템 1개. 양도 가능하며 사용 효과가 없는 아이템만 등록합니다.</p>

        <label>
          이름
          <input required maxLength={100} value={draft.name} disabled={busy} onChange={e => setDraft({...draft, name: e.target.value})}/>
        </label>

        <label>
          활성
          <input type="checkbox" checked={draft.is_active} disabled={busy} onChange={e => setDraft({...draft, is_active: e.target.checked})}/>
        </label>

        {['start_at', 'end_at'].map(key => (
            <label key={key}>
              {key === 'start_at' ? '시작' : '종료'} 시각 (시간대 포함 ISO)
              <input value={draft[key] || ''} disabled={busy} onChange={e => setDraft({...draft, [key]: e.target.value || null})}/>
            </label>
        ))}

        <p>
          활성 보상 잔여 재고: {total} · {total ? '판매 가능' : '전체 품절'}
          {rows.some(r => r.is_active !== false && r.max_stock == null) ? ' · 재고 전환 HOLD' : ''}
        </p>

        <label>
          등록 보상 이름·ID 검색
          <input value={query} onChange={e => {setQuery(e.target.value); setPage(0);}}/>
        </label>

        <p>{filtered.length}종 · {page + 1}페이지</p>

        {filtered.slice(page * 20, page * 20 + 20).map(({row, index}) => (
            <fieldset key={index} disabled={busy}>
              <legend>{row.name || '새 RP 보상'} · ID {row.item_id || '미선택'}</legend>

              <ItemPicker rpOnly label="RP 보상" value={row.item_id} disabled={busy || !!row.id} onDenied={onDenied} onChange={(id, item) => change(index, {item_id: id, name: item?.name || ''})}/>

              <label>
                활성
                <input type="checkbox" checked={row.is_active !== false} onChange={e => change(index, {is_active: e.target.checked})}/>
              </label>

              {['max_stock', 'remaining_stock'].map(key => (
                  <label key={key}>
                    {key === 'max_stock' ? '최대 당첨 수량' : '잔여 재고'}
                    <input required={row.is_active !== false} type="number" min={key === 'max_stock' ? 1 : 0} max={2147483647} step="1" value={row[key] ?? ''} onChange={e => change(index, {[key]: e.target.value === '' ? null : Number(e.target.value)})}/>
                  </label>
              ))}

              <p>
                {row.max_stock == null ? '기존 재고 미확정' : `누적 당첨 ${row.max_stock - row.remaining_stock}개`} ·
                {row.remaining_stock === 0 ? '품절' : '재고 있음'} ·
                현재 확률 {row.is_active !== false && total ? ((row.remaining_stock || 0) / total * 100).toFixed(4) : '0'}%
              </p>

              <button type="button" onClick={() => {setDraft({...draft, rewards: rows.filter((_, i) => i !== index)}); setPage(0);}}>행 제외 (저장 시 비활성화)</button>
            </fieldset>
        ))}

        <div>
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>이전 보상</button>
          <button type="button" disabled={(page + 1) * 20 >= filtered.length} onClick={() => setPage(page + 1)}>다음 보상</button>
        </div>

        <button type="button" disabled={busy} onClick={() => {
          setQuery('');
          setPage(Math.floor(rows.length / 20));
          setDraft({...draft, rewards: [...rows, {item_id: '', quantity: 1, is_active: true, max_stock: 1, remaining_stock: 1}]});
        }}>보상 추가</button>

        <p>신규 재고는 최대=잔여로 등록합니다. 운영 중 최대·잔여를 같은 수량만큼 조정하여 이미 당첨된 수량을 보존하세요. 동시 추첨으로 값이 바뀌면 새로 조회해야 합니다.</p>

        <button disabled={busy}>저장</button>
        <p role="alert">{message}</p>
      </form>
  );
}