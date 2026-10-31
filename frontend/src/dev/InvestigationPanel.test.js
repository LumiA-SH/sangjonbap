import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import InvestigationPanel from './InvestigationPanel';

function render(cost, ap) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<InvestigationPanel
    areas={[{id: '1', name: 'DEV', is_open: true, investigation_rate: 0}]}
    investigationApCost={cost} character={{ap, status: 'ALIVE'}}/>);
  return {text: container.textContent,
    button: [...container.querySelectorAll('button')].find(button => button.textContent === '조사하기')};
}

test('server cost drives both displayed AP and investigation button', () => {
  expect(render(3, 2).text).toContain('AP 3을 소비');
  expect(render(3, 2).button.disabled).toBe(true);
  expect(render(3, 3).button.disabled).toBe(false);
  expect(render(7, 3).button.disabled).toBe(true);
  expect(render(7, 7).text).toContain('AP 7을 소비');
  expect(render(0, 0).button.disabled).toBe(false);
});

test('missing or invalid cost never falls back to one AP', () => {
  for (const cost of [undefined, null, '1', -1, 1.5]) {
    const view = render(cost, 10);
    expect(view.button.disabled).toBe(true);
    expect(view.text).toContain('조사 비용을 불러오지 못했습니다');
  }
});
