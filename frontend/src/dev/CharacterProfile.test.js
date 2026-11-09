import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import CharacterCarePanel from './CharacterCarePanel';
import CharacterPanel from './CharacterPanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let root,container;
beforeEach(()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;
  Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});
  api.mockReset();container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const button=text=>[...container.querySelectorAll('button')].find(b=>b.textContent===text);
async function search(){
  await act(async()=>Simulate.change(container.querySelector('#character-search'),{target:{value:'동명'}}));
  await act(async()=>Simulate.submit(container.querySelector('form')));
}
test('same names distinguish IDs; selecting uses existing heal/revive numeric ID path',async()=>{
  await act(async()=>root.render(<CharacterCarePanel character={{id:'1',status:'ALIVE'}} run={fn=>fn()} refresh={async()=>true} notify={()=>{}}/>));
  api.mockResolvedValueOnce({characters:[{id:'2',name:'동명'},{id:'3',name:'동명'}]});await search();
  await act(async()=>button('ID 3 선택').click());expect(container.querySelector('#care-target').value).toBe('3');
  for(const [label,path] of [['대상 치료','/characters/3/heal'],['대상 부활','/characters/3/revive'],['자기 치료','/characters/1/heal']]){
    api.mockResolvedValueOnce({action:path.endsWith('/revive')?'revive':'heal',provider:{blood:80},target:{id:path.split('/')[2],name:'동명',hp:50},cost:10,hpRecovery:20,expected:{providerBlood:70,targetHp:70,targetBlood:50,targetAp:7}});
    await act(async()=>button(label).click());
    api.mockResolvedValueOnce({provider:{},target:{}}).mockResolvedValueOnce({logs:[]});
    await act(async()=>button('실행 확인').click());expect(api).toHaveBeenCalledWith(path,expect.objectContaining({method:'POST'}));
  }
  await act(async()=>Simulate.change(container.querySelector('#care-target'),{target:{value:'9'}}));expect(container.querySelector('#care-target').value).toBe('9');
});
test('failed search clears previous results and shows server error, empty search results distinct',async()=>{
  await act(async()=>root.render(<CharacterCarePanel character={{id:'1',status:'ALIVE'}} run={fn=>fn()}/>));
  api.mockResolvedValueOnce({characters:[{id:'2',name:'동명'}]});await search();expect(button('ID 2 선택')).toBeDefined();
  api.mockRejectedValueOnce(Object.assign(new Error('조회 실패'),{code:'SERVER_ERROR'}));await search();expect(button('ID 2 선택')).toBeUndefined();expect(container.textContent).toContain('SERVER_ERROR');
  api.mockResolvedValueOnce({characters:[]});await search();expect(container.textContent).toContain('검색 결과가 없습니다');
});
test('nullable profile read-only display and ability label, URL not activated',async()=>{
  await act(async()=>root.render(<CharacterPanel character={{id:'1',name:'DEV',age:null,job:'직업',position:'M',profile_url:'javascript:alert(1)',ability_grade:'A'}}/>));
  expect(container.textContent).toContain('이능관리등급: A');expect(container.textContent).toContain('미등록');
  expect(container.textContent).toContain('직업');expect(container.querySelector('a')).toBeNull();
  expect(container.querySelectorAll('input').length).toBe(1);
});
