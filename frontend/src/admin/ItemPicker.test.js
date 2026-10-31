import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import ItemPicker from './ItemPicker';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let root,container;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;api.mockReset();container=document.createElement('div');root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());});
test('name search distinguishes equal names and selects numeric ID with effect metadata',async()=>{
  const select=jest.fn();await act(async()=>root.render(<ItemPicker value="" onChange={select}/>));
  await act(async()=>Simulate.change(container.querySelector('input'),{target:{value:'혈액팩'}}));
  const rows=[{id:'4',name:'혈액팩',category:'CONSUMABLE',is_active:true,effect_type:'BLOOD_PACK'},{id:'5',name:'혈액팩',category:'ETC',is_active:false}];
  api.mockResolvedValueOnce({records:rows});await act(async()=>container.querySelector('button').click());
  expect(api).toHaveBeenCalledWith('/admin/items/search?q='+encodeURIComponent('혈액팩'));
  expect(container.textContent).toContain('ID 4 · CONSUMABLE');expect(container.textContent).toContain('ID 5 · ETC');
  await act(async()=>container.querySelector('li button').click());expect(select).toHaveBeenCalledWith('4',rows[0]);
});
test('search failures and permissions are visible; stale search cannot replace newer query',async()=>{
  const denied=jest.fn();await act(async()=>root.render(<ItemPicker value="" onChange={()=>{}} onDenied={denied}/>));
  await act(async()=>Simulate.change(container.querySelector('input'),{target:{value:'a'}}));
  let resolve;api.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  await act(async()=>container.querySelector('button').click());
  await act(async()=>Simulate.change(container.querySelector('input'),{target:{value:'b'}}));
  await act(async()=>resolve({records:[{id:'1',name:'stale'}]}));expect(container.textContent).not.toContain('stale');
  api.mockRejectedValueOnce(Object.assign(new Error('권한 없음'),{status:403,code:'ADMIN_REQUIRED'}));
  await act(async()=>container.querySelector('button').click());expect(denied).toHaveBeenCalledWith('권한 없음');
});
