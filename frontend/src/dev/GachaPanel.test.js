import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import GachaPanel from './GachaPanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let root,container,refresh,notify;
const gacha={id:'4',name:'DEV 가챠',price:10,start_at:null,end_at:null,outside:false,boundary:false,
  rewards:[{id:'8',name:'보상',quantity:2,weight:7,isActive:true}]};
async function render(overrides={}) {
  await act(async()=>root.render(<GachaPanel gachas={[gacha]} character={{status:'ALIVE'}} busy={false}
    run={fn=>fn()} refresh={refresh} notify={notify} {...overrides}/>));
}
const draw=()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='1회 뽑기');
beforeEach(async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;
  Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:jest.fn(()=> '12345678-1234-4234-8234-123456789012')}});
  api.mockReset();refresh=jest.fn(async()=>true);notify=jest.fn();
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);await render();
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
test('catalog hides rewards and preserves period/status/error controls',async()=>{
  expect(container.textContent).not.toContain('가중치');expect(container.textContent).not.toContain('보상');expect(container.textContent).toContain('가격 10');
  for(const state of [{outside:true},{boundary:true}]) {await render({gachas:[{...gacha,...state}]});expect(draw().disabled).toBe(true);}
  for(const status of ['DEAD','NEAR_DEATH']) {await render({character:{status}});expect(draw().disabled).toBe(true);}
  await render({error:'offline'});expect(draw().disabled).toBe(true);
});
test('one POST in flight, UUID, result, error replaces result and success refresh',async()=>{
  let resolve;api.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  await act(async()=>{draw().click();draw().click();});expect(api).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenCalledWith('/gacha/4/draw',{method:'POST',body:{requestKey:'12345678-1234-4234-8234-123456789012'}});
  await act(async()=>resolve({reward:{name:'보상',quantity:2},currency:90}));
  expect(container.textContent).toContain('추첨 결과');expect(refresh).toHaveBeenCalledTimes(1);
  api.mockRejectedValueOnce(Object.assign(new Error('재화 부족'),{code:'NOT_ENOUGH_CURRENCY'}));
  await act(async()=>draw().click());expect(container.textContent).toContain('NOT_ENOUGH_CURRENCY');expect(container.textContent).not.toContain('추첨 결과');
  expect(refresh).toHaveBeenCalledTimes(1);expect(crypto.randomUUID).toHaveBeenCalledTimes(2);
});
test('refresh failure preserves committed draw',async()=>{
  api.mockResolvedValueOnce({reward:{name:'보상',quantity:2}});refresh.mockRejectedValueOnce(new Error('offline'));
  await act(async()=>draw().click());expect(container.textContent).toContain('추첨 결과');expect(notify).toHaveBeenCalledWith(expect.stringContaining('일부 조회 실패'));
});
