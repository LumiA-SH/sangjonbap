import {useRef, useState} from 'react';
import {api} from '../api/client';
import CharacterSearch from './CharacterSearch';

export default function TrainingBloodPanel({character, inventory, busy, run, refresh}) {
  const [itemId, setItemId] = useState('');
  const [target, setTarget] = useState(null);
  const [message, setMessage] = useState('');

  const sending = useRef(false);

  const blocked = busy ||
      !character ||
      character.in_active_battle ||
      character.status === 'DEAD';

  const packs = inventory.filter(item => item.effect_type === 'BLOOD_PACK');
  const selected = packs.find(item => String(item.item_id) === itemId);

  const validTarget = !!target &&
      /^[1-9][0-9]{0,18}$/.test(String(target.id)) &&
      String(target.id) !== String(character?.id);

  async function perform(path, body = {}) {
    if (busy || sending.current) return;

    sending.current = true;

    try {
      await run(async () => {
        setMessage('');

        let result;

        try {
          result = await api(path, {
            method: 'POST',
            body: {...body, requestKey: crypto.randomUUID()}
          });
        } catch (error) {
          setMessage(`${error.code || 'REQUEST_FAILED'}: ${error.message}`);
          return;
        }

        setMessage(`성공: ${JSON.stringify(result)}`);

        try {
          if (!await refresh()) {
            setMessage(current => current + ' · 일부 상태 재조회 실패');
          }
        } catch {
          setMessage(current => current + ' · 상태 재조회 실패');
        }
      });
    } finally {
      sending.current = false;
    }
  }

  function selectTarget(id, row) {
    setTarget({
      id: String(id), name: row?.name || '이름 확인 필요'
    });

    setMessage('');
  }

  function transferBloodPack() {
    if (!selected || !validTarget || blocked) return;

    perform(`/inventory/blood-packs/${itemId}/transfer`, {
      targetId: target.id,
      quantity: 1
    });
  }

  return (
      <section className="survival-training-blood-panel">
        <h2>일일훈련·혈액팩</h2>

        <p>훈련: KST 하루 1회, AP 0, 재화 +1. 빈사·사망 상태에서는 불가합니다.</p>

        <button type="button" disabled={blocked || character?.status !== 'ALIVE'} onClick={() => perform('/training')}>
          일일훈련
        </button>

        <div className="survival-blood-pack-controls">
          <label className="survival-blood-pack-picker">
            보유 혈액팩

            <select value={itemId} disabled={busy} onChange={event => setItemId(event.target.value)}>
              <option value="">혈액팩 선택</option>

              {packs.map(item => (
                  <option key={item.item_id} value={item.item_id}>
                    {item.name} ({item.quantity}개)
                  </option>
              ))}
            </select>
          </label>

          <button type="button" disabled={blocked || !selected} onClick={() => perform(`/inventory/blood-packs/${itemId}/use`)}>
            혈액팩 사용
          </button>
        </div>

        <div className="survival-blood-transfer-search">
          <CharacterSearch
              inputId="blood-transfer-target-search"
              label="양도 대상 캐릭터 이름 검색"
              busy={busy}
              onSelect={selectTarget}
              onQueryChange={() => setTarget(null)}
              collapseOnSelect
              action={
                <button type="button" className="survival-blood-transfer-button" disabled={blocked || !selected || !validTarget} onClick={transferBloodPack}>
                  혈액팩 1개 양도
                </button>
              }
          />

          {target && (
              <div className="survival-blood-transfer-target">
                        <span>
                            선택한 대상: <strong>{target.name}</strong>
                            <small> ID {target.id}</small>
                        </span>

                <button type="button" disabled={busy} onClick={() => setTarget(null)}>
                  선택 해제
                </button>
              </div>
          )}
        </div>

        {message && <p role="status">{message}</p>}
      </section>
  );
}