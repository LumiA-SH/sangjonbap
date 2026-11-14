import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';

const itemCache = new Map();

export default function ItemPicker({
                                     value,
                                     onChange,
                                     disabled = false,
                                     label = '아이템',
                                     onDenied = () => {},
                                     rpOnly = false,
                                     type = 'all'
                                   }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const sequence = useRef(0);
  const selectionSequence = useRef(0);

  const typeNames = {
    all: '아이템',
    food: '완성 음식',
    'failure-food': '실패 요리'
  };

  useEffect(() => {
    const token = ++selectionSequence.current;

    if (!value) {
      setSelected(null);
      return;
    }

    const key = String(value);

    if (itemCache.has(key)) {
      setSelected(itemCache.get(key));
      return;
    }

    setSelected(null);

    api(`/admin/items/${encodeURIComponent(key)}`)
        .then(data => {
          if (token !== selectionSequence.current) return;

          const item = data.record;
          itemCache.set(key, item);
          setSelected(item);
        })
        .catch(error => {
          if (token !== selectionSequence.current) return;

          setMessage(`선택된 ${label}의 이름을 불러오지 못했습니다: ${error.message}`);

          if ([401, 403].includes(error.status)) {
            onDenied(error.message);
          }
        });

    return () => {
      selectionSequence.current++;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function search() {
    const token = ++sequence.current;

    if (!query.trim()) {
      setRows([]);
      setMessage('검색할 이름을 입력하세요.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const params = new URLSearchParams({q: query.trim()});

      if (rpOnly) params.set('rp', 'true');
      if (type !== 'all') params.set('type', type);

      const data = await api(`/admin/items/search?${params.toString()}`);

      if (token !== sequence.current) return;

      const records = data.records || [];
      setRows(records);

      setMessage(
          records.length
              ? `${records.length}건 검색되었습니다. 사용할 항목을 선택하세요.`
              : `${typeNames[type] || '아이템'} 검색 결과가 없습니다.`
      );
    } catch (error) {
      if (token !== sequence.current) return;

      setRows([]);
      setMessage(`${error.code || 'SEARCH_FAILED'}: ${error.message}`);

      if ([401, 403].includes(error.status)) {
        onDenied(error.message);
      }
    } finally {
      if (token === sequence.current) setBusy(false);
    }
  }

  function changeQuery(next) {
    sequence.current++;
    setQuery(next);
    setRows([]);
    setMessage('');
    setBusy(false);
  }

  function selectItem(item) {
    itemCache.set(String(item.id), item);
    setSelected(item);
    onChange(String(item.id), item);
    setQuery('');
    setRows([]);
    setMessage('');
  }

  function clearItem() {
    setSelected(null);
    onChange(null, null);
    setQuery('');
    setRows([]);
    setMessage('');
  }

  function itemDescription(item) {
    const categoryNames = {
      MATERIAL: '재료',
      CONSUMABLE: '소모품',
      FOOD: '음식',
      ETC: '기타'
    };

    const category = categoryNames[item.category] || item.category;

    if (item.is_food) {
      const foodType = item.food_type === 'FAILURE'
          ? '실패 요리'
          : item.food_type === 'LEGACY_FAILURE'
              ? '기존 실패 요리'
              : '일반 음식';

      return `${category} · ${foodType}`;
    }

    return category;
  }

  return (
      <div className="admin-item-picker">
        <label>
          {label} 이름 검색
          <input
              type="search"
              value={query}
              maxLength={100}
              placeholder={`${typeNames[type] || '아이템'} 이름 입력`}
              disabled={disabled}
              onChange={event => changeQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  search();
                }
              }}
          />
        </label>

        <button type="button" disabled={disabled || busy} onClick={search}>
          {busy ? '검색 중…' : '이름 검색'}
        </button>

        {message && <p role="status">{message}</p>}

        {rows.length > 0 && (
            <ul className="admin-item-search-results">
              {rows.map(item => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {itemDescription(item)}
                        {' · '}
                        {item.is_active ? '활성' : '비활성'}
                      </small>
                    </div>

                    <button
                        type="button"
                        disabled={disabled || (type !== 'all' && !item.is_active)}
                        onClick={() => selectItem(item)}
                    >
                      선택
                    </button>
                  </li>
              ))}
            </ul>
        )}

        <div className="admin-selected-item">
          {selected && String(selected.id) === String(value) ? (
              <>
                <div>
                  <strong>{selected.name}</strong>
                  <small>{itemDescription(selected)}</small>
                </div>

                <button type="button" disabled={disabled} onClick={clearItem}>
                  선택 해제
                </button>
              </>
          ) : value ? (
              <span>선택된 항목의 이름을 확인하는 중…</span>
          ) : (
              <span>선택된 {label}이 없습니다.</span>
          )}
        </div>
      </div>
  );
}