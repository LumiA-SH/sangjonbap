import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import ItemTransferPanel from './ItemTransferPanel';
import {api} from '../api/client';
jest.mock('../api/client', () => ({api: jest.fn()}));
let container, root, refresh, notify;
const key = '12345678-1234-4234-8234-123456789012';
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text);
async function render(character = {id: '1', status: 'ALIVE'}) {
  await act(async () => root.render(<ItemTransferPanel inventory={[{item_id: '7', name: '재료', transferable: true, quantity: 3}]}
    character={character} busy={false} run={fn => fn()} refresh={refresh} notify={notify}/>));
}
async function change(selector, value) {
  await act(async () => Simulate.change(container.querySelector(selector), {target: {value}}));
}
async function selectTarget() {
  await change('#transfer-character-search', '생존자');
  api.mockResolvedValueOnce({characters: [{id: '2', name: '생존자'}, {id: '3', name: '생존자'}]});
  await act(async () => Simulate.submit(container.querySelector('form')));
  await act(async () => button('ID 2 선택').click());
  await change('#transfer-item', '7');
}
beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(global, 'crypto', {configurable: true, value: {randomUUID: jest.fn(() => key)}});
  api.mockReset(); refresh = jest.fn(async () => true); notify = jest.fn();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await render();
});
afterEach(async () => {await act(async () => root.unmount()); container.remove();});

test('name search distinguishes IDs; confirmation sends selected IDs and UUID then refreshes', async () => {
  await selectTarget();
  await change('#transfer-quantity', '2');
  await act(async () => button('양도 내용 확인').click());
  expect(api).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('생존자 (ID 2)에게 재료 (ID 7) 2개');
  api.mockResolvedValueOnce({});
  await act(async () => button('양도 확정').click());
  expect(api).toHaveBeenLastCalledWith('/inventory/transfer', {method: 'POST', body: {itemId: '7', targetId: '2', quantity: 2, requestKey: key}});
  expect(refresh).toHaveBeenCalledTimes(1); expect(notify).toHaveBeenCalledTimes(1);
});

test('validates quantities, allows near death and blocks dead/active state', async () => {
  await selectTarget();
  for (const value of ['0', '-1', '1.5', '4']) {
    await change('#transfer-quantity', value); expect(button('양도 내용 확인').disabled).toBe(true);
  }
  await change('#transfer-quantity', '1');
  await render({id: '1', status: 'NEAR_DEATH'}); expect(button('양도 내용 확인').disabled).toBe(false);
  await render({id: '1', status: 'DEAD'}); expect(button('양도 내용 확인').disabled).toBe(true);
  await render({id: '1', status: 'ALIVE', in_active_battle: true}); expect(button('양도 내용 확인').disabled).toBe(true);
});

test('pending clicks are suppressed and failure shows code without success refresh', async () => {
  await selectTarget(); await act(async () => button('양도 내용 확인').click());
  let reject;
  api.mockImplementationOnce(() => new Promise((resolve, fail) => {reject = fail;}));
  await act(async () => {button('양도 확정').click(); button('양도 확정').click();});
  expect(api).toHaveBeenCalledTimes(2);
  await act(async () => reject(Object.assign(new Error('상대 전투 중'), {code: 'BATTLE_ACTIVE'})));
  expect(container.textContent).toContain('BATTLE_ACTIVE: 상대 전투 중');
  expect(refresh).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
});
