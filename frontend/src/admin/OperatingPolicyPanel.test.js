import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import OperatingPolicyPanel from './OperatingPolicyPanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let root,container;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;window.confirm=jest.fn(()=>true);Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});api.mockReset();container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
test('unconfigured policy stays empty and save includes previous values',async()=>{
 const settings={enabled:false,cost:null,recovery:null,minimumRemaining:null,maximum:null,dailyLimitEnabled:false,dailyLimit:null};api.mockResolvedValue({settings});
 await act(async()=>root.render(<OperatingPolicyPanel onDenied={jest.fn()}/>));
 expect(container.querySelector('input[type=number]').value).toBe('');
 await act(async()=>Simulate.submit(container.querySelector('form')));
 expect(api).toHaveBeenLastCalledWith('/admin/policies/donation',expect.objectContaining({method:'PATCH',body:expect.objectContaining({settings,before:settings})}));
 expect(container.textContent).toContain('저장 완료');
});
test('denied policy read revokes administrator view',async()=>{
 const onDenied=jest.fn();api.mockRejectedValue({status:403,message:'권한 없음'});
 await act(async()=>root.render(<OperatingPolicyPanel onDenied={onDenied}/>));expect(onDenied).toHaveBeenCalledWith('권한 없음');expect(container.querySelector('form')).toBeNull();
});

test('anemia editor keeps empty boundaries and cancellation does not save',async()=>{
 api.mockImplementation(async path=>({settings:path.endsWith('/anemia')?{enabled:false,stages:[]}:{enabled:false}}));const onDenied=jest.fn();
 await act(async()=>root.render(<OperatingPolicyPanel onDenied={onDenied}/>));await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='빈혈 RP 단계').click());
 await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='단계 추가').click());
 expect([...container.querySelectorAll('input[type=number]')].slice(0,2).map(e=>e.value)).toEqual(['','']);
 window.confirm.mockReturnValue(false);await act(async()=>Simulate.submit(container.querySelector('form')));expect(api.mock.calls.filter(c=>c[1]?.method==='PATCH')).toHaveLength(0);
});
