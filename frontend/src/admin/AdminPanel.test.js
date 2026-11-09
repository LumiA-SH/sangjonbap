import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import AdminPanel from './AdminPanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let root,container;
const button=text=>[...container.querySelectorAll('button')].find(b=>b.textContent===text);
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});window.history.replaceState(null,"","/");window.confirm=jest.fn(()=>true);window.scrollTo=jest.fn();api.mockReset();container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
async function mount(){await act(async()=>root.render(<AdminPanel onBack={()=>{}}/>));}
test('permission denied exposes no editors or management data',async()=>{
  api.mockRejectedValueOnce(Object.assign(new Error('관리자 필요'),{status:403,code:'ADMIN_REQUIRED'}));await mount();
  expect(container.textContent).toContain('ADMIN_REQUIRED');expect(container.querySelector('form')).toBeNull();expect(api).toHaveBeenCalledTimes(1);
});
test('item creation uses admin endpoint UUID and reload; failure visible',async()=>{
  api.mockResolvedValueOnce({role:'ADMIN'}).mockResolvedValueOnce({records:[],nextAfter:null});await mount();
  const input=container.querySelector('input[type=text]');await act(async()=>Simulate.change(input,{target:{value:'새 아이템'}}));
  api.mockResolvedValueOnce({record:{id:'5',name:'새 아이템',category:'ETC',description:null,transferable:true,is_active:true}}).mockResolvedValueOnce({records:[],nextAfter:null});
  await act(async()=>Simulate.submit(container.querySelector('form')));
  expect(api).toHaveBeenCalledWith('/admin/items',expect.objectContaining({method:'POST',body:expect.objectContaining({name:'새 아이템',requestKey:'12345678-1234-4234-8234-123456789012'})}));
  expect(container.textContent).toContain('저장 성공');
  api.mockRejectedValueOnce(Object.assign(new Error('잘못된 입력'),{code:'INVALID_ADMIN_INPUT',status:400}));
  await act(async()=>Simulate.submit(container.querySelector('form')));expect(container.textContent).toContain('INVALID_ADMIN_INPUT');
});
test('product unlimited controls send null and role revocation removes editor',async()=>{
  api.mockResolvedValueOnce({role:'ADMIN'}).mockResolvedValueOnce({records:[],nextAfter:null});await mount();
  api.mockResolvedValueOnce({records:[],nextAfter:null});await act(async()=>button('상점 상품').click());
  expect(container.textContent).toContain('무제한(NULL)');
  await act(async()=>Simulate.change(container.querySelector('details input'),{target:{value:'7'}}));
  api.mockRejectedValueOnce(Object.assign(new Error('권한 회수'),{status:403,code:'ADMIN_REQUIRED'}));
  await act(async()=>Simulate.submit(container.querySelector('form')));
  expect(api).toHaveBeenCalledWith('/admin/products',expect.objectContaining({body:expect.objectContaining({item_id:'7',purchase_limit:null,stock_limit:null})}));
  expect(container.querySelector('form')).toBeNull();expect(container.textContent).toContain('권한 회수');
});
test('registered blood pack links to a free daily-limited shop draft without ID typing',async()=>{
  const item={id:'8',name:'혈액팩',category:'CONSUMABLE',effect_type:'BLOOD_PACK',effect_value:30,usable:true,use_target:'SELF',transferable:true,is_active:true};
  api.mockResolvedValueOnce({role:'ADMIN'}).mockResolvedValueOnce({records:[item]});await mount();
  api.mockResolvedValueOnce({record:item});await act(async()=>button('상세/수정').click());
  api.mockResolvedValueOnce({records:[]});await act(async()=>button('이 아이템을 상점에 등록').click());
  api.mockResolvedValueOnce({record:{id:'9',item_id:'8',price:0,daily_limit:1}}).mockResolvedValueOnce({records:[]});
  await act(async()=>Simulate.submit(container.querySelector('form')));
  expect(api).toHaveBeenCalledWith('/admin/products',expect.objectContaining({method:'POST',body:expect.objectContaining({item_id:'8',price:0,daily_limit:1})}));
});

test('authority loss on window focus removes existing editors',async()=>{
 api.mockResolvedValueOnce({role:'ADMIN'}).mockResolvedValueOnce({records:[]});await mount();expect(container.querySelector('form')).not.toBeNull();
 api.mockRejectedValueOnce(Object.assign(new Error('권한 회수'),{status:403}));await act(async()=>window.dispatchEvent(new Event('focus')));expect(container.querySelector('form')).toBeNull();expect(container.querySelector('.admin-navigation')).toBeNull();
});
test('cancelled save never sends a mutation',async()=>{
 api.mockResolvedValueOnce({role:'ADMIN'}).mockResolvedValueOnce({records:[]});await mount();window.confirm.mockReturnValue(false);api.mockClear();
 await act(async()=>Simulate.submit(container.querySelector('form')));expect(api).not.toHaveBeenCalled();
});
test('direct record URL fetches authoritative record and cancel returns to list',async()=>{
 const navigate=jest.fn();api.mockImplementation(path=>Promise.resolve(path==='/admin/access'?{role:'ADMIN'}:path==='/admin/items/7'?{record:{id:'7',name:'기존 물품',category:'ETC',is_active:true}}:{records:[]}));
 await act(async()=>root.render(<AdminPanel route={{menu:'items',record:'7'}} onNavigate={navigate} onBack={()=>{}}/>));
 expect(api).toHaveBeenCalledWith('/admin/items/7');expect(container.querySelector('form').textContent).toContain('ID 7 수정');
 await act(async()=>button('편집 취소 · 목록으로').click());expect(navigate).toHaveBeenCalledWith({record:null});
});
