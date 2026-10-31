import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import TrainingBloodPanel from './TrainingBloodPanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let container,root,refresh;
const button=text=>[...container.querySelectorAll('button')].find(b=>b.textContent===text);
async function render(status='ALIVE') {
  await act(async()=>root.render(<TrainingBloodPanel character={{status}} inventory={[{item_id:'7',name:'이름 무관',effect_type:'BLOOD_PACK',quantity:2}]} busy={false} run={fn=>fn()} refresh={refresh}/>));
}
beforeEach(async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});
  api.mockReset();refresh=jest.fn(async()=>true);container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);await render();
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
test('training request, UUID, success refresh and server errors',async()=>{
  api.mockResolvedValueOnce({reward:1});await act(async()=>button('일일훈련').click());
  expect(api).toHaveBeenCalledWith('/training',expect.objectContaining({body:{requestKey:'12345678-1234-4234-8234-123456789012'}}));
  expect(refresh).toHaveBeenCalledTimes(1);
  api.mockRejectedValueOnce(Object.assign(new Error('완료'),{code:'TRAINING_ALREADY_DONE'}));await act(async()=>button('일일훈련').click());
  expect(container.textContent).toContain('TRAINING_ALREADY_DONE');expect(refresh).toHaveBeenCalledTimes(1);
});
test('near death blocks training/send but allows explicit-effect pack use; dead cannot use',async()=>{
  await render('NEAR_DEATH');await act(async()=>Simulate.change(container.querySelector('select'),{target:{value:'7'}}));
  expect(button('일일훈련').disabled).toBe(true);expect(button('혈액팩 1개 양도').disabled).toBe(true);expect(button('혈액팩 사용').disabled).toBe(false);
  api.mockResolvedValueOnce({blood:30,status:'ALIVE'});await act(async()=>button('혈액팩 사용').click());
  expect(api).toHaveBeenCalledWith('/inventory/blood-packs/7/use',expect.objectContaining({method:'POST'}));
  await render('DEAD');expect(button('혈액팩 사용').disabled).toBe(true);
});
