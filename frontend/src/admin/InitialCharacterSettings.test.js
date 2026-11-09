import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import InitialCharacterSettings from './InitialCharacterSettings';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let root,div,onSaved,onDenied;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});api.mockReset();window.confirm=jest.fn(()=>false);div=document.createElement('div');root=createRoot(div);onSaved=jest.fn();onDenied=jest.fn();});
afterEach(async()=>{await act(async()=>root.unmount());});
async function mount(){await act(async()=>root.render(<InitialCharacterSettings character={{id:'5',name:'러너',updated_at:'2026-11-10T00:00:00.000Z'}} onSaved={onSaved} onDenied={onDenied}/>));
 const selects=div.querySelectorAll('select');await act(async()=>{Simulate.change(selects[0],{target:{value:'B'}});Simulate.change(selects[1],{target:{value:'no'}});});
 for(const input of div.querySelectorAll('input'))await act(async()=>Simulate.change(input,{target:{value:'12'}}));}
test('confirmation cancellation does not write; confirmed save sends only setup fields and version',async()=>{
 await mount();await act(async()=>Simulate.submit(div.querySelector('form')));expect(api).not.toHaveBeenCalled();
 window.confirm.mockReturnValue(true);api.mockResolvedValue({});await act(async()=>Simulate.submit(div.querySelector('form')));
 expect(api).toHaveBeenCalledTimes(1);expect(api).toHaveBeenCalledWith('/admin/characters/5/initial-settings',expect.objectContaining({method:'PATCH',body:expect.objectContaining({hunter_grade:'B',atk:12,def:12,agi:12,has_ability:false,ability_grade:null,expectedUpdatedAt:'2026-11-10T00:00:00.000Z'})}));expect(onSaved).toHaveBeenCalledTimes(1);
});
test('double submission is blocked; server conflict is visible and permission denial exits',async()=>{
 await mount();window.confirm.mockReturnValue(true);let reject;api.mockImplementation(()=>new Promise((_,r)=>{reject=r;}));
 await act(async()=>{Simulate.submit(div.querySelector('form'));Simulate.submit(div.querySelector('form'));});expect(api).toHaveBeenCalledTimes(1);
 await act(async()=>reject(Object.assign(Error('관리자 권한 없음'),{status:403})));expect(div.textContent).toContain('관리자 권한 없음');expect(onDenied).toHaveBeenCalled();
});
