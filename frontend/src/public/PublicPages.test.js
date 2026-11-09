import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import GuidePage,{kst} from './GuidePage';
import CharacterDirectory from './CharacterDirectory';
import AnemiaNotice,{anemiaText,AnemiaPolicyContext} from './AnemiaNotice';
import ContentAdminPanel from '../admin/ContentAdminPanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let div,root;beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;api.mockReset();window.confirm=jest.fn(()=>true);Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});div=document.createElement('div');root=createRoot(div);});afterEach(async()=>{await act(async()=>root.unmount());});
const button=t=>[...div.querySelectorAll('button')].find(b=>b.textContent===t);
test('unregistered content, retry and plain text safety',async()=>{
 api.mockResolvedValue({content:null});await act(async()=>root.render(<GuidePage kind="world"/>));expect(div.textContent).toContain('현재 공개된 안내가 없습니다');api.mockRejectedValueOnce(Error('연결 실패'));await act(async()=>root.render(<GuidePage key="system" kind="system"/>));expect(div.textContent).toContain('연결 실패');api.mockResolvedValue({content:{items:[{id:'1',title:'규칙',body:'<script>alert(1)</script>\n문단'}]}});await act(async()=>button('다시 불러오기').click());expect(div.querySelector('script')).toBeNull();expect(div.querySelector('.public-prose').textContent).toContain('\n문단');
});
test('schedule displays server state and KST rather than client clock',async()=>{
 const start='2026-12-23T15:00:00Z',end='2027-01-10T15:00:00Z';expect(kst(start)).toContain('24');expect(kst(start)).toContain('00:00');api.mockResolvedValue({serverNow:start,content:{title:'일정',body:'',startAt:start,endAt:end,state:'ENDED',items:[]}});await act(async()=>root.render(<GuidePage kind="schedule"/>));expect(div.textContent).toContain('종료');expect(div.textContent).toContain('KST');
});
test('guest profile never requests runner inventory; authenticated detail reuses existing API',async()=>{
 const character={id:'2',name:'러너',hunter_grade:'A',has_ability:true,ability_grade:'B',status:'DEAD'};api.mockImplementation(async p=>p==='/public/characters/2'?{character}:p==='/characters/2/public'?{character:{...character,hp:0,blood:0},inventory:[]}:{records:[character]});const open=jest.fn(),back=jest.fn();await act(async()=>root.render(<CharacterDirectory onOpen={open} onBack={back}/>));await act(async()=>button('러너').click());expect(open).toHaveBeenCalledWith('2');await act(async()=>root.render(<CharacterDirectory recordId="2" onOpen={open} onBack={back} canReadDetails={false}/>));expect(div.textContent).toContain('헌터 A');expect(api.mock.calls.some(([p])=>p==='/characters/2/public')).toBe(false);await act(async()=>root.render(<CharacterDirectory recordId="2" onOpen={open} onBack={back} canReadDetails/>));expect(api).toHaveBeenCalledWith('/characters/2/public');expect(div.textContent).toContain('소지품');await act(async()=>button('목록으로 돌아가기').click());expect(back).toHaveBeenCalled();
});
test('admin confirmation, duplicate clicks and conflict display',async()=>{
 api.mockResolvedValue({content:{title:'원래',body:'본문',published:false},version:'v1'});await act(async()=>root.render(<ContentAdminPanel kind="world"/>));await act(async()=>Simulate.change(div.querySelector('input'),{target:{value:'수정'}}));window.confirm.mockReturnValue(false);await act(async()=>Simulate.submit(div.querySelector('form')));expect(api.mock.calls.filter(c=>c[1]?.method==='PATCH')).toHaveLength(0);window.confirm.mockReturnValue(true);let reject;api.mockImplementation(()=>new Promise((r,j)=>{reject=j;}));await act(async()=>{Simulate.submit(div.querySelector('form'));Simulate.submit(div.querySelector('form'));});expect(api.mock.calls.filter(c=>c[1]?.method==='PATCH')).toHaveLength(1);expect(api).toHaveBeenLastCalledWith('/admin/content/world',expect.objectContaining({body:expect.objectContaining({expectedVersion:'v1'})}));await act(async()=>reject(Object.assign(Error('다시 조회'),{code:'CONTENT_CHANGED'})));expect(div.textContent).toContain('CONTENT_CHANGED');
});
test('RP names require configuration, preserve zero/dead states and refresh with blood',async()=>{
 const policy={enabled:true,stages:[{name:'낮음',min:1,max:49,order:0},{name:'높음',min:50,max:100,order:1}]};
 for(const blood of [1,50,100])expect(anemiaText({hp:100,status:'ALIVE',blood})).toBeNull();
 expect(anemiaText({hp:100,blood:1},policy)).toBe('낮음');expect(anemiaText({hp:100,blood:100},policy)).toBe('높음');
 expect(anemiaText({hp:100,blood:0},policy)).toBeNull();expect(anemiaText({hp:0,blood:50,status:'DEAD'},policy)).toBeNull();expect(anemiaText({hp:100,blood:50},{...policy,enabled:false})).toBeNull();
 const render=blood=><AnemiaPolicyContext.Provider value={policy}><AnemiaNotice character={{hp:100,status:'ALIVE',blood}}/></AnemiaPolicyContext.Provider>;
 await act(async()=>root.render(render(1)));expect(div.textContent).toBe(' · 낮음');expect(div.textContent).not.toContain('/100');await act(async()=>root.render(render(100)));expect(div.textContent).toBe(' · 높음');await act(async()=>root.render(render(0)));expect(div.textContent).toBe('');
});
