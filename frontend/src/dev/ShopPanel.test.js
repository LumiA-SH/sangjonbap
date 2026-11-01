import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import ShopPanel from './ShopPanel';
import {api} from '../api/client';
jest.mock('../api/client', () => ({api: jest.fn()}));
let root,container,refresh,notify;
const product={id:'7',name:'DEV 상품',price:10,personalRemaining:null,globalRemaining:2};
async function render(overrides={}) {
  await act(async()=>root.render(<ShopPanel products={[product]} character={{status:'ALIVE'}} busy={false}
    run={fn=>fn()} refresh={refresh} notify={notify} {...overrides}/>));
}
const buy=()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='구매');
beforeEach(async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;
  Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:jest.fn(()=> '12345678-1234-4234-8234-123456789012')}});
  api.mockReset(); refresh=jest.fn(async()=>true);notify=jest.fn();
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);await render();
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
test('shows independent limits and validates quantity, stock, DEAD and HOLD',async()=>{
  expect(container.textContent).toContain('개인 잔여 무제한');expect(container.textContent).toContain('전체 잔여 2');
  for(const value of ['0','-1','1.5','abc','3']) {
    await act(async()=>Simulate.change(container.querySelector('input'),{target:{value}}));expect(buy().disabled).toBe(true);
  }
  await act(async()=>Simulate.change(container.querySelector('input'),{target:{value:'1'}}));
  expect(buy().disabled).toBe(false);
  await render({character:{status:'DEAD'}});expect(buy().disabled).toBe(true);
  await render({character:{status:'NEAR_DEATH'}});expect(container.textContent).toContain('상점을 이용');expect(buy().disabled).toBe(false);
  await render({character:{status:'NEAR_DEATH'},products:[{...product,effect_type:'BLOOD_PACK',price:0,dailyRemaining:1}]});expect(buy().disabled).toBe(false);
  await render({character:{status:'NEAR_DEATH'},products:[{...product,effect_type:'BLOOD_PACK',price:0,dailyRemaining:0}]});expect(buy().disabled).toBe(true);
});
test('real API contract with UUID, one submission per in-flight action, refresh after success',async()=>{
  let resolve;api.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  await act(async()=>{buy().click();buy().click();});expect(api).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenCalledWith('/shop/products/7/buy',{method:'POST',body:{quantity:1,requestKey:'12345678-1234-4234-8234-123456789012'}});
  await act(async()=>resolve({currency:90,quantity:1}));expect(refresh).toHaveBeenCalledTimes(1);expect(container.textContent).toContain('구매 성공');
  api.mockRejectedValueOnce(Object.assign(new Error('재고 부족'),{code:'OUT_OF_STOCK'}));
  await act(async()=>buy().click());expect(container.textContent).toContain('OUT_OF_STOCK');expect(container.textContent).not.toContain('구매 성공');
  expect(refresh).toHaveBeenCalledTimes(1);expect(crypto.randomUUID).toHaveBeenCalledTimes(2);
});
test('refresh failure cannot turn committed purchase into a failed purchase',async()=>{
  api.mockResolvedValueOnce({currency:90});refresh.mockRejectedValueOnce(new Error('offline'));
  await act(async()=>buy().click());expect(container.textContent).toContain('구매 성공');expect(notify).toHaveBeenCalledWith(expect.stringContaining('일부 조회 실패'));
});

test('active battle blocks purchase even while otherwise ALIVE',async()=>{
  await render({character:{status:'ALIVE',in_active_battle:true}});
  expect(buy().disabled).toBe(true);
  await act(async()=>buy().click());expect(api).not.toHaveBeenCalled();
});

test('recipe product has fixed quantity and prevents already learned purchase',async()=>{
  await render({products:[{...product,item_id:null,recipe_id:'23',learned:false}]});
  expect(container.textContent).toContain('구매 즉시 습득');expect(container.querySelector('input').disabled).toBe(true);
  await render({products:[{...product,item_id:null,recipe_id:'23',learned:true}]});
  expect(buy().disabled).toBe(true);expect(container.textContent).toContain('습득 완료');
});
