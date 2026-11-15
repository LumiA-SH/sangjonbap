import {useRef, useState} from 'react';
import {api} from '../api/client';
import CharacterSearch from './CharacterSearch';

export default function ItemTransferPanel({inventory = [], character, busy, error, run, refresh, notify}) {
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

  function selectTarget(id, row) {
    setTarget(row);
    setConfirmation(null);
    setFailure('');
  }

  function clearTarget() {
    setTarget(null);
    setConfirmation(null);
  }

  async function transfer() {
    if (sending.current || disabled || !valid || !confirmation) return;

    sending.current = true;
    setPending(true);
    setFailure('');
    const input = confirmation;

    try {
      await run(async () => {
        try {
          await api('/inventory/transfer', {
            method: 'POST',
            body: {itemId: input.itemId, targetId: input.targetId, quantity: input.quantity, requestKey: crypto.randomUUID()}
          });

          setConfirmation(null);
          const synced = await refresh();
          notify(`${input.targetName}(ID ${input.targetId})에게 ${input.itemName} ${input.quantity}개 양도 완료${synced ? '' : ' · 일부 상태 조회 실패'}`);
        } catch (e) {
          setConfirmation(null);
          setFailure(`${e.code || 'TRANSFER_FAILED'}: ${e.message}`);
        }
      });
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
      <section className="inventory-sharing" aria-labelledby="item-transfer-title">
        <div className="inventory-sharing-heading">
          <div>
            <h3 id="item-transfer-title">다른 캐릭터에게 아이템 양도</h3>
            <p>캐릭터를 검색하고 보낼 아이템과 수량을 선택하세요.</p>
          </div>
          <span>양도 가능 아이템 {items.length}종</span>
        </div>

        <div className="inventory-sharing-content">
          <div className="inventory-transfer-target">
            <CharacterSearch busy={disabled} inputId="transfer-character-search" label="양도 대상 캐릭터 이름 검색" onSelect={selectTarget} onQueryChange={clearTarget} collapseOnSelect/>

            {target && (
                <div className="inventory-selected-target">
                  <span>선택한 대상: <strong>{target.name}</strong><small> ID {target.id}</small></span>
                  <button type="button" disabled={disabled} onClick={clearTarget}>선택 해제</button>
                </div>
            )}
          </div>

          <div className="inventory-transfer-fields">
            <div>
              <label htmlFor="transfer-item">양도할 아이템</label>
              <select id="transfer-item" value={itemId} disabled={disabled} onChange={e => {setItemId(e.target.value); setConfirmation(null);}}>
                <option value="">아이템 선택</option>
                {items.map(value => (
                    <option key={value.item_id} value={value.item_id}>{value.name} · 보유 {value.quantity}개</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="transfer-quantity">양도 수량</label>
              <input id="transfer-quantity" type="number" min="1" step="1" max={item?.quantity} value={quantity} disabled={disabled} onChange={e => {setQuantity(e.target.value); setConfirmation(null);}}/>
            </div>

            <button type="button" className="inventory-transfer-preview" disabled={disabled || !valid} onClick={() => {
              setFailure('');
              setConfirmation({itemId, itemName: item.name, targetId: String(target.id), targetName: target.name, quantity: amount});
            }}>양도 내용 확인</button>
          </div>
        </div>

        {confirmation && (
            <div className="inventory-transfer-confirm" role="group" aria-label="양도 최종 확인">
              <div>
                <h4>아이템 양도 확인</h4>
                <p><strong>{confirmation.targetName}</strong> (ID {confirmation.targetId})에게 <strong>{confirmation.itemName}</strong> {confirmation.quantity}개를 보냅니다.</p>
              </div>
              <div>
                <button type="button" disabled={disabled || !valid} onClick={transfer}>양도 확정</button>
                <button type="button" disabled={disabled} onClick={() => setConfirmation(null)}>취소</button>
              </div>
            </div>
        )}

        {failure && <p className="inventory-notice" role="alert">{failure}</p>}
        <p className="inventory-sharing-note">빈사 상태에서도 양도·수령할 수 있지만, 전투 중이거나 양측 중 하나가 사망한 경우 서버에서 거부합니다.</p>
      </section>
  );
}