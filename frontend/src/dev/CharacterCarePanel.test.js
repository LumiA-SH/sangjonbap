import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import CharacterCarePanel, {validCharacterId} from './CharacterCarePanel';
import {api} from '../api/client';

jest.mock('../api/client', () => ({api: jest.fn()}));
let container, root, refresh, notify;
const key = '12345678-1234-4234-8234-123456789012';
beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(global, 'crypto', {configurable: true, value: {randomUUID: jest.fn(() => key)}});
  api.mockReset();
  refresh = jest.fn(async () => true);
  notify = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<CharacterCarePanel character={{id: '1'}} busy={false}
    run={task => task()} refresh={refresh} notify={notify}/>));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text);
async function target(value) {
  await act(async () => Simulate.change(container.querySelector('input'), {target: {value}}));
}
function success() {
  api.mockResolvedValueOnce({provider: {blood: 80}, target: {hp: 70}})
    .mockResolvedValueOnce({logs: [{request_key: key, detail: {before: {provider: {blood: 90}, target: {hp: 50}}}}]});
}

test('validates positive PostgreSQL IDs without unsafe number conversion', async () => {
  for (const value of ['', '0', '-1', '1.5', '1e2', ' 2', '9223372036854775808']) {
    expect(validCharacterId(value)).toBe(false);
    await target(value);
    expect(button('대상 치료').disabled).toBe(true);
  }
  expect(validCharacterId('9223372036854775807')).toBe(true);
});

test('self heal, target heal and revive use server APIs, fresh UUID and refresh', async () => {
  await target('2');
  for (const [label, path] of [['자기 치료', '/characters/1/heal'], ['대상 치료', '/characters/2/heal'], ['대상 부활', '/characters/2/revive']]) {
    success();
    await act(async () => button(label).click());
    expect(api).toHaveBeenCalledWith(path, {method: 'POST', body: {requestKey: key}});
    expect(container.textContent).toContain('90');
    expect(container.textContent).toContain('70');
  }
  expect(crypto.randomUUID).toHaveBeenCalledTimes(3);
  expect(refresh).toHaveBeenCalledTimes(3);
});

test('same-tick double click sends one request and disables controls while pending', async () => {
  let reject;
  api.mockImplementationOnce(() => new Promise((resolve, fail) => { reject = fail; }));
  await act(async () => { button('자기 치료').click(); button('자기 치료').click(); });
  expect(api).toHaveBeenCalledTimes(1);
  expect(button('자기 치료').disabled).toBe(true);
  await act(async () => reject(Object.assign(new Error('전투 중 외부 개입 불가'), {code: 'ACTIVE_BATTLE'})));
  expect(container.textContent).toContain('ACTIVE_BATTLE');
  expect(container.textContent).toContain('전투 중 외부 개입 불가');
  expect(refresh).not.toHaveBeenCalled();
});

test('failed action clears previous success; log read failure preserves committed success', async () => {
  success();
  await act(async () => button('자기 치료').click());
  api.mockRejectedValueOnce(Object.assign(new Error('혈량 부족'), {code: 'INSUFFICIENT_BLOOD'}));
  await act(async () => button('자기 치료').click());
  expect(container.querySelector('[aria-label="치료 부활 결과"]')).toBeNull();
  expect(container.textContent).toContain('INSUFFICIENT_BLOOD');
  api.mockResolvedValueOnce({provider: {blood: 1}, target: {hp: 2}}).mockRejectedValueOnce(new Error('로그 오류'));
  await act(async () => button('자기 치료').click());
  expect(container.textContent).toContain('치료 성공');
  expect(container.textContent).toContain('변경 전 로그 조회 실패');
  expect(refresh).toHaveBeenCalledTimes(2);
});
