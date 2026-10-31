import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import CookingPanel from './CookingPanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let container,root,refresh,notify;
const catalog = {cookingApCost:3,dailyMealCount:0,dailyMealLimit:5,successQuantity:4,failureQuantity:1,
  recipes:[{id:'2',name:'DEV 레시피',learn_cost:10,success_rate:50,result_quantity:4,learned:false,ingredients:[]}],
  foods:[{item_id:'7',name:'DEV 음식',quantity:2,blood_recovery:10,stat_growth_enabled:true,stat_growth_target:'ATK',stat_growth_value:2,stat_growth_rate:50}]};
async function render(overrides={}) {
  await act(async()=>root.render(<CookingPanel catalog={catalog} character={{status:'ALIVE',ap:10}} busy={false}
    run={fn=>fn()} refresh={refresh} notify={notify} {...overrides}/>));
}
const button = text => [...container.querySelectorAll('button')].find(b=>b.textContent===text);
beforeEach(async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;
  Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:jest.fn(()=> '12345678-1234-4234-8234-123456789012')}});
  api.mockReset();refresh=jest.fn(async()=>true);notify=jest.fn();
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);await render();
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
test('server AP cost, learned state, meal limit and policy HOLD drive controls',async()=>{
  expect(button('요리').disabled).toBe(true);expect(container.textContent).toContain('요리 AP 3');
  const learned={...catalog,recipes:[{...catalog.recipes[0],learned:true}]};
  await render({catalog:learned,character:{status:'ALIVE',ap:2}});expect(button('요리').disabled).toBe(true);
  await render({catalog:learned});expect(button('요리').disabled).toBe(false);expect(button('습득').disabled).toBe(true);
  await render({catalog:{...catalog,dailyMealCount:5}});expect(button('식사').disabled).toBe(true);
  for (const status of ['DEAD','NEAR_DEATH']) {await render({character:{status,ap:10}});expect(button('식사').disabled).toBe(true);expect(button('습득').disabled).toBe(true);}
});
test('learn/cook/eat use actual API paths and UUID, refresh after committed failure outcome',async()=>{
  api.mockResolvedValueOnce({currency:90});await act(async()=>button('습득').click());
  expect(api).toHaveBeenLastCalledWith('/cooking/recipes/2/learn',expect.objectContaining({method:'POST'}));
  await render({catalog:{...catalog,recipes:[{...catalog.recipes[0],learned:true}]}});
  api.mockResolvedValueOnce({succeeded:false,output:{quantity:1}});await act(async()=>button('요리').click());
  expect(container.textContent).toContain('요리 실패');expect(api).toHaveBeenLastCalledWith('/cooking/recipes/2/cook',expect.anything());
  api.mockResolvedValueOnce({dailyMealCount:1});await act(async()=>button('식사').click());
  expect(api).toHaveBeenLastCalledWith('/cooking/foods/7/eat',{method:'POST',body:{requestKey:'12345678-1234-4234-8234-123456789012'}});
  expect(crypto.randomUUID).toHaveBeenCalledTimes(3);expect(refresh).toHaveBeenCalledTimes(3);
});
test('in-flight duplicate prevented, errors clear old success and do not refresh',async()=>{
  let resolve;api.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  await act(async()=>{button('식사').click();button('식사').click();});expect(api).toHaveBeenCalledTimes(1);
  await act(async()=>resolve({dailyMealCount:1}));
  api.mockRejectedValueOnce(Object.assign(new Error('음식 부족'),{code:'NOT_ENOUGH_FOOD'}));
  await act(async()=>button('식사').click());expect(container.textContent).toContain('NOT_ENOUGH_FOOD');expect(container.textContent).not.toContain('처리 결과');
  expect(refresh).toHaveBeenCalledTimes(1);
});
