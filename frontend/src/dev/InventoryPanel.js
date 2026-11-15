import {useRef, useState} from 'react';
import {api} from '../api/client';
import ItemTransferPanel from './ItemTransferPanel';
import './InventoryPanel.css';

function ItemImage({item, large = false}) {
  const [failed, setFailed] = useState(false);
  const url = item?.image_url;
  const safeImage = typeof url === 'string' && /^(https?:\/\/|\/(?!\/))/.test(url);

  return (
      <div className={`inventory-item-image${large ? ' is-large' : ''}`}>
        {safeImage && !failed
            ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)}/>
            : <span>이미지 없음</span>}
      </div>
  );
}

function itemCount(items) {
  return items.reduce((total, item) => total + Number(item.quantity || 0), 0);
}

export default function InventoryPanel({inventory = [], storage = [], character, errors = {}, busy, run, refresh, notify}) {
  const [tab, setTab] = useState('inventory');
  const [selectedIds, setSelectedIds] = useState({inventory: null, storage: null});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ALL');
  const [quantity, setQuantity] = useState('1');
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  const group = tab === 'inventory'
      ? {title: '개인 인벤토리', items: inventory, direction: 'deposit', action: '창고에 넣기', error: errors.inventory}
      : {title: '공용창고', items: storage, direction: 'withdraw', action: '창고에서 꺼내기', error: errors.storage};

  const categories = [...new Set(group.items.map(item => item.category).filter(Boolean))];
  const filtered = group.items.filter(item => {
    const matchesCategory = category === 'ALL' || item.category === category;
    const keyword = query.trim().toLowerCase();
    const matchesQuery = !keyword || `${item.name} ${item.description || ''}`.toLowerCase().includes(keyword);
    return matchesCategory && matchesQuery;
  });

  const selectedItem = filtered.find(item => String(item.item_id) === selectedIds[tab]) || filtered[0] || null;
  const amount = Number(quantity);
  const itemId = Number(selectedItem?.item_id);
  const validQuantity = !!selectedItem && Number.isSafeInteger(itemId) && itemId > 0 &&
      Number.isSafeInteger(amount) && amount > 0 && amount <= Number(selectedItem.quantity);

  const disabled = busy || pending || character?.in_active_battle || character?.status === 'DEAD' ||
      !!errors.inventory || !!errors.storage;
  const canMove = !disabled && selectedItem?.transferable && validQuantity;

  function changeTab(value) {
    setTab(value);
    setQuery('');
    setCategory('ALL');
    setQuantity('1');
  }

  function selectItem(id) {
    setSelectedIds(current => ({...current, [tab]: String(id)}));
    setQuantity('1');
  }

  function changeQuery(value) {
    setQuery(value);
    setQuantity('1');
  }

  function changeCategory(value) {
    setCategory(value);
    setQuantity('1');
  }

  async function moveItem(event) {
    event.preventDefault();
    if (sending.current || !canMove) return;

    const direction = group.direction;
    const action = group.action;
    const name = selectedItem.name;
    sending.current = true;
    setPending(true);

    try {
      await run(async () => {
        await api(`/inventory/storage/${direction}`, {
          method: 'POST',
          body: {itemId, quantity: amount, requestKey: crypto.randomUUID()}
        });

        const synced = await refresh();
        notify(`${name} ${amount}개 ${action} 완료${synced ? '' : ' · 일부 상태 조회 실패: 패널 오류를 확인하세요.'}`);
      });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
      <section className="survival-inventory" aria-labelledby="inventory-title">
        <header className="inventory-header">
          <div>
            <h2 id="inventory-title">인벤토리</h2>
            <p>보유 물품과 공용창고를 확인하고 아이템을 관리합니다.</p>
          </div>
          <button type="button" disabled={busy || pending} onClick={() => run(refresh)}>인벤토리 새로고침</button>
        </header>

        <div className="inventory-summary">
          <div><small>보유 아이템 종류</small><strong>{inventory.length}</strong></div>
          <div><small>보유 아이템 총수량</small><strong>{itemCount(inventory)}</strong></div>
          <div><small>공용창고 아이템 종류</small><strong>{storage.length}</strong></div>
          <div><small>공용창고 총수량</small><strong>{itemCount(storage)}</strong></div>
        </div>

        {errors.inventory && <p className="inventory-notice" role="alert">개인 인벤토리 조회 실패: {errors.inventory} · 이전 표시값일 수 있습니다.</p>}
        {errors.storage && <p className="inventory-notice" role="alert">공용창고 조회 실패: {errors.storage} · 이전 표시값일 수 있습니다.</p>}
        {character?.in_active_battle && <p className="inventory-notice">전투 중에는 창고 입출고와 아이템 양도를 할 수 없습니다.</p>}
        {character?.status === 'DEAD' && <p className="inventory-notice">사망한 캐릭터는 아이템을 이동할 수 없습니다.</p>}

        <div className="inventory-workspace">
          <div className="inventory-browser">
            <nav className="inventory-tabs" aria-label="인벤토리 유형 선택">
              <button type="button" className={tab === 'inventory' ? 'is-active' : ''} aria-pressed={tab === 'inventory'} disabled={pending} onClick={() => changeTab('inventory')}>
                내 가방 <span>{inventory.length}</span>
              </button>
              <button type="button" className={tab === 'storage' ? 'is-active' : ''} aria-pressed={tab === 'storage'} disabled={pending} onClick={() => changeTab('storage')}>
                공용창고 <span>{storage.length}</span>
              </button>
            </nav>

            <div className="inventory-browser-content">
              <div className="inventory-browser-heading">
                <h3>{group.title}</h3>
                <span>{filtered.length}종 표시</span>
              </div>

              <div className="inventory-filters">
                <input type="search" value={query} placeholder="아이템 이름 검색" aria-label="아이템 이름 검색" onChange={event => changeQuery(event.target.value)}/>
                <select value={category} aria-label="아이템 분류 선택" onChange={event => changeCategory(event.target.value)}>
                  <option value="ALL">전체 분류</option>
                  {categories.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>

              {filtered.length ? (
                  <div className="inventory-item-list">
                    {filtered.map(item => (
                        <button type="button" key={item.item_id} className={`inventory-item-card${String(selectedItem?.item_id) === String(item.item_id) ? ' is-selected' : ''}`} aria-pressed={String(selectedItem?.item_id) === String(item.item_id)} onClick={() => selectItem(item.item_id)}>
                          <ItemImage key={`${item.item_id}:${item.image_url || ''}`} item={item}/>
                          <div className="inventory-item-info">
                            <strong>{item.name}</strong>
                            <small>{item.category || '기타'}</small>
                          </div>
                          <span className="inventory-item-count">× {item.quantity}</span>
                        </button>
                    ))}
                  </div>
              ) : (
                  <div className="inventory-empty">
                    {group.items.length ? '검색 조건에 맞는 아이템이 없습니다.' : '표시할 아이템이 없습니다.'}
                  </div>
              )}
            </div>
          </div>

          <section className="inventory-detail" aria-label="아이템 상세 정보">
            {selectedItem ? (
                <>
                  <div className="inventory-detail-heading">
                    <h3>아이템 정보</h3>
                    <span>ID {selectedItem.item_id}</span>
                  </div>

                  <div className="inventory-detail-main">
                    <ItemImage key={`${selectedItem.item_id}:${selectedItem.image_url || ''}`} item={selectedItem} large/>
                    <div>
                      <span className="inventory-detail-category">{selectedItem.category || '기타'}</span>
                      <h4>{selectedItem.name}</h4>
                      <p>보유 수량 <strong>{selectedItem.quantity}개</strong></p>
                    </div>
                  </div>

                  <p className="inventory-description">{selectedItem.description || '등록된 아이템 설명이 없습니다.'}</p>

                  <div className="inventory-properties">
                    <span>{selectedItem.transferable ? '이동 가능' : '이동 불가'}</span>
                    {selectedItem.battle_usable && <span>전투 사용 가능</span>}
                    {selectedItem.usable && <span>사용 가능</span>}
                  </div>

                  <form className="inventory-storage-form" onSubmit={moveItem}>
                    <div className="inventory-storage-heading">
                      <h4>{tab === 'inventory' ? '공용창고에 보관' : '공용창고에서 꺼내기'}</h4>
                      <span>최대 {selectedItem.quantity}개</span>
                    </div>
                    <label htmlFor="inventory-move-quantity">이동 수량</label>
                    <div className="inventory-storage-controls">
                      <input id="inventory-move-quantity" type="number" min="1" max={selectedItem.quantity} step="1" value={quantity} disabled={disabled || !selectedItem.transferable} onChange={event => setQuantity(event.target.value)}/>
                      <button type="submit" disabled={!canMove}>{group.action}</button>
                    </div>
                    {!selectedItem.transferable && <p>이 아이템은 공용창고로 이동할 수 없습니다.</p>}
                    {!validQuantity && selectedItem.transferable && <p>1개 이상, 보유 수량 이하로 입력해 주세요.</p>}
                  </form>
                </>
            ) : (
                <div className="inventory-detail-empty">
                  <h3>선택된 아이템이 없습니다.</h3>
                  <p>왼쪽 목록에서 아이템을 선택하면 상세 정보와 이동 기능이 표시됩니다.</p>
                </div>
            )}
          </section>
        </div>

        <ItemTransferPanel inventory={inventory} character={character} busy={busy} error={errors.inventory} run={run} refresh={refresh} notify={notify}/>
      </section>
  );
}