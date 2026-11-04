import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import GachaStockEditor from './GachaStockEditor';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let container,root;
const button=text=>[...container.querySelectorAll('button')].find(b=>b.textContent===text);
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});api.mockReset();container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
async function render(rewards){await act(async()=>root.render(<GachaStockEditor record={{id:'4',name:'RP',rewards}} onSaved={async()=>{}} onDenied={()=>{}} onBusy={()=>{}}/>));}
test('hundreds of rewards are searchable and paged in groups of twenty',async()=>{
    await render(Array.from({length:105},(_,i)=>({id:String(i+1),item_id:String(i+1),name:`물품${i+1}`,max_stock:3,remaining_stock:2,is_active:true})));
    expect(container.querySelectorAll('fieldset')).toHaveLength(20);
    await act(async()=>button('다음 보상').click());expect(container.textContent).toContain('물품21');
    const search=[...container.querySelectorAll('label')].find(l=>l.textContent.startsWith('등록 보상')).querySelector('input');
    await act(async()=>Simulate.change(search,{target:{value:'물품105'}}));expect(container.querySelectorAll('fieldset')).toHaveLength(1);expect(container.textContent).toContain('물품105');
});
test('legacy null stock is never silently filled or submitted',async()=>{
    await render([{id:'2',item_id:'8',name:'과거 보상',max_stock:null,remaining_stock:null}]);
    await act(async()=>Simulate.submit(container.querySelector('form')));expect(api).not.toHaveBeenCalled();expect(container.textContent).toContain('전환 HOLD');
});
test('RP picker calls restricted search; activation and stock submit without probability or weight',async()=>{
    await render([]);await act(async()=>button('보상 추가').click());
    const search=[...container.querySelectorAll('label')].find(l=>l.textContent==='RP 보상 이름 검색').querySelector('input');
    await act(async()=>Simulate.change(search,{target:{value:'기념'}}));api.mockResolvedValueOnce({records:[{id:'9',name:'기념품',category:'ETC',is_active:true}]});
    await act(async()=>button('아이템 검색').click());expect(api).toHaveBeenCalledWith('/admin/items/search?q=%EA%B8%B0%EB%85%90&rp=true');
    await act(async()=>button('선택').click());api.mockResolvedValueOnce({record:{id:'4'}});
    await act(async()=>Simulate.submit(container.querySelector('form')));
    expect(api).toHaveBeenLastCalledWith('/admin/gachas/4',expect.objectContaining({body:expect.objectContaining({price:1,rewards:[{item_id:'9',quantity:1,is_active:true,max_stock:1,remaining_stock:1}]})}));
});
