import {useState} from 'react';
import {api} from '../api/client';

function ItemTransfer({item, direction, disabled, run, refresh, notify}) {
  const [quantity, setQuantity] = useState('1');
  const amount = Number(quantity);
  const itemId = Number(item.item_id);
  const valid = Number.isSafeInteger(amount) && amount > 0 && amount <= Number(item.quantity) && Number.isSafeInteger(itemId);
  const label = direction === 'deposit' ? '창고에 넣기' : '창고에서 꺼내기';
  return <li className="dev-row">
    <strong>{item.name} × {item.quantity}</strong>
    <p>ID {item.item_id} · {item.category} · {item.transferable ? '이동 가능' : '이동 불가'}</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (!valid || disabled || !item.transferable) return;
      run(async () => {
        await api(`/inventory/storage/${direction}`, {
          method: 'POST', body: {itemId, quantity: amount, requestKey: crypto.randomUUID()}
        });
        const synced = await refresh();
        notify(`${item.name} ${amount}개 ${label} 완료${synced ? '' : ' · 일부 상태 조회 실패: 패널 오류를 확인하세요.'}`);
      });
    }}>
      <label htmlFor={`${direction}-${item.item_id}`}>수량</label>
      <input id={`${direction}-${item.item_id}`} type="number" min="1" max={item.quantity} step="1"
        value={quantity} onChange={event => setQuantity(event.target.value)} disabled={disabled || !item.transferable}/>
      <button disabled={disabled || !item.transferable || !valid}>{label}</button>
    </form>
  </li>;
}

export default function InventoryPanel({inventory, storage, errors, busy, run, refresh, notify}) {
  const disabled = busy || !!errors.inventory || !!errors.storage;
  return <section aria-labelledby="inventory-title">
    <span className="badge">INVENTORY / STORAGE</span>
    <h2 id="inventory-title">인벤토리·공용창고 DEV</h2>
    <button disabled={busy} onClick={() => run(refresh)}>인벤토리 새로고침</button>
    {[
      {title: '개인 인벤토리', items: inventory, direction: 'deposit', error: errors.inventory},
      {title: '공용창고', items: storage, direction: 'withdraw', error: errors.storage}
    ].map(group => <div key={group.direction}>
      <h3>{group.title}</h3>
      {group.error && <p role="alert">조회 실패: {group.error} · 이전 표시값일 수 있습니다.</p>}
      {group.items.length === 0 ? <p>표시할 아이템이 없습니다.</p> : <ul className="dev-list">
        {group.items.map(item => <ItemTransfer key={item.item_id} item={item} direction={group.direction}
          disabled={disabled} run={run} refresh={refresh} notify={notify}/>)}
      </ul>}
    </div>)}
  </section>;
}
