import {useRef, useState} from 'react';
import {api} from '../api/client';
import CharacterSearch from './CharacterSearch';

export default function ItemTransferPanel({inventory, character, busy, error, run, refresh, notify}) {
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [target, setTarget] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [failure, setFailure] = useState('');
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const disabled = busy || pending || !character || !!error || character.status === 'DEAD' || character.in_active_battle;
  const items = inventory.filter(item => item.transferable && Number(item.quantity) > 0);
  const item = items.find(value => String(value.item_id) === itemId);
  const amount = Number(quantity);
  const valid = item && target && String(target.id) !== String(character?.id) &&
    Number.isSafeInteger(amount) && amount > 0 && amount <= Number(item.quantity) && amount <= 2147483647;

  async function transfer() {
    if (sending.current || disabled || !valid || !confirmation) return;
    sending.current = true; setPending(true); setFailure('');
    const input = confirmation;
    try {
      await run(async () => {
        try {
          await api('/inventory/transfer', {method: 'POST', body: {
            itemId: input.itemId, targetId: input.targetId, quantity: input.quantity, requestKey: crypto.randomUUID()
          }});
          setConfirmation(null);
          const synced = await refresh();
          notify(`${input.targetName}(ID ${input.targetId})에게 ${input.itemName} ${input.quantity}개 양도 완료${synced ? '' : ' · 일부 상태 조회 실패'}`);
        } catch (e) { setConfirmation(null); setFailure(`${e.code || 'TRANSFER_FAILED'}: ${e.message}`); }
      });
    } finally { sending.current = false; setPending(false); }
  }

  return <div aria-labelledby="item-transfer-title">
    <h3 id="item-transfer-title">다른 캐릭터에게 아이템 양도</h3>
    <CharacterSearch busy={disabled} inputId="transfer-character-search" label="양도 대상 이름 검색"
      onSelect={(id, row) => {setTarget(row); setConfirmation(null); setFailure('');}}/>
    {target && <p>받는 캐릭터: {target.name} · ID {target.id}</p>}
    <label htmlFor="transfer-item">아이템</label>
    <select id="transfer-item" value={itemId} disabled={disabled} onChange={e => {setItemId(e.target.value); setConfirmation(null);}}>
      <option value="">양도할 아이템 선택</option>
      {items.map(value => <option key={value.item_id} value={value.item_id}>{value.name} · ID {value.item_id} · 보유 {value.quantity}개</option>)}
    </select>
    <label htmlFor="transfer-quantity">양도 수량</label>
    <input id="transfer-quantity" type="number" min="1" step="1" max={item?.quantity} value={quantity}
      disabled={disabled} onChange={e => {setQuantity(e.target.value); setConfirmation(null);}}/>
    <button disabled={disabled || !valid} onClick={() => {setFailure(''); setConfirmation({
      itemId, itemName: item.name, targetId: String(target.id), targetName: target.name, quantity: amount
    });}}>양도 내용 확인</button>
    {confirmation && <div role="group" aria-label="양도 최종 확인">
      <p>{confirmation.targetName} (ID {confirmation.targetId})에게 {confirmation.itemName} (ID {confirmation.itemId}) {confirmation.quantity}개를 보냅니다.</p>
      <button disabled={disabled || !valid} onClick={transfer}>양도 확정</button>
      <button disabled={disabled} onClick={() => setConfirmation(null)}>취소</button>
    </div>}
    {failure && <p role="alert">{failure}</p>}
    <p>빈사 상태도 양도·수령 가능하며, 양측 사망 또는 전투 중에는 서버에서 거부합니다.</p>
  </div>;
}
