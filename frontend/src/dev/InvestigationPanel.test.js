import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {readLocation} from '../admin/navigation';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
import {renderToStaticMarkup} from 'react-dom/server';
import InvestigationPanel, {rewardText} from './InvestigationPanel';

test('recipe entitlement and inventory reward have distinct displays', () => {
  expect(rewardText({recipeId: 2, name: '레시피'})).toBe('레시피 · 레시피 최초 발견 · 무료 습득 · 상점 등록');
  expect(rewardText({name: '재료', quantity: 2, inventoryQuantity: 3})).toBe('재료 × 2 · 지급 후 보유 3');
});

function render(cost, ap, overrides={}) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<InvestigationPanel
    areas={[{id: '1', name: 'DEV', is_open: true, investigation_rate: 0}]}
    investigationApCost={cost} character={{ap, status: 'ALIVE'}} {...overrides}/>);
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

test('near-death, dead and active battle disable actions without hiding areas',()=>{
  for(const overrides of [{character:{ap:10,status:'NEAR_DEATH'}},{character:{ap:10,status:'DEAD'}},{activeBattle:true},{battleError:'조회 실패'}]) {
    const view=render(1,10,overrides);
    expect(view.button.disabled).toBe(true);expect(view.text).toContain('DEV');
  }
});

test('missing or invalid cost never falls back to one AP', () => {
  for (const cost of [undefined, null, '1', -1, 1.5]) {
    const view = render(cost, 10);
    expect(view.button.disabled).toBe(true);
    expect(view.text).toContain('조사 비용을 불러오지 못했습니다');
  }
});

test('encounter link selects battle tab rather than unknown-anchor home fallback',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});
 const container=document.createElement('div'),root=createRoot(container);document.body.appendChild(container);
 const refresh=jest.fn(async()=>true),notify=jest.fn();
 api.mockResolvedValueOnce({result:{result_text:'조사',result_grade:'COMMON',is_unique:false},area:{investigation_rate:0},ap:9,battle:{id:'42'},rewards:[],clue:null});
 try{
  window.history.replaceState(null,'','/#game/investigation');
  await act(async()=>root.render(<InvestigationPanel areas={[{id:'1',name:'구역',is_open:true}]} investigationApCost={1} character={{ap:10,status:'ALIVE'}} run={fn=>fn()} refresh={refresh} notify={notify}/>));
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='조사하기').click());
  const link=container.querySelector('a');expect(link.getAttribute('href')).toBe('#game/battle');
  window.history.pushState(null,'',link.getAttribute('href'));expect(readLocation().tab).toBe('battle');expect(readLocation().admin).toBe(false);
  expect(container.textContent).toContain('응답 JSON / requestKey');expect(container.textContent).toContain('42');
 }finally{await act(async()=>root.unmount());container.remove();window.history.replaceState(null,'','/');}
});

test.each([true,false])('lost response retains key and checks committed record: %s',async(committed)=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;api.mockReset();
 const uuid=jest.fn().mockReturnValueOnce('12345678-1234-4234-8234-123456789012').mockReturnValueOnce('22345678-1234-4234-8234-123456789012');
 Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:uuid}});
 const result={result:{result_text:'조사',result_grade:'COMMON'},area:{investigation_rate:0},ap:9,rewards:[]};
 api.mockRejectedValueOnce(Object.assign(new Error('timeout'),{code:'API_TIMEOUT'}));
 api.mockResolvedValueOnce({records:committed?[{request_key:'12345678-1234-4234-8234-123456789012',action_type:'INVESTIGATE'}]:[]});api.mockResolvedValue(result);
 const container=document.createElement('div'),root=createRoot(container);
 const click=async(text)=>act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent===text).click());
 try{
 await act(async()=>root.render(<InvestigationPanel areas={[{id:'1',name:'구역',is_open:true}]} investigationApCost={1} character={{id:'1',ap:10,status:'ALIVE'}} run={fn=>fn().catch(()=>{})} refresh={async()=>true} notify={()=>{}}/>));
 await click('조사하기');expect(api).toHaveBeenCalledTimes(1);expect(container.textContent).toContain('결과 미확인');
 await click('기록 확인 및 같은 요청 재시도');
 const posts=api.mock.calls.filter(c=>c[1]?.method==='POST');expect(posts).toHaveLength(committed?1:2);
 if(!committed)expect(posts[1][1].body.requestKey).toBe(posts[0][1].body.requestKey);
 expect(container.textContent).not.toContain('결과 미확인');
 await click('조사하기');expect(api.mock.calls.at(-1)[1].body.requestKey).toBe('22345678-1234-4234-8234-123456789012');
 }finally{await act(async()=>root.unmount());}
});
