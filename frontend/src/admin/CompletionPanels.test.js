import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import StorageAdminPanel from './StorageAdminPanel';
import ClueAdminPanel from './ClueAdminPanel';
import CharacterDetailsEditor from './CharacterDetailsEditor';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let root,container;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;window.confirm=jest.fn(()=>true);Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});api.mockReset();container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const button=text=>[...container.querySelectorAll('button')].find(b=>b.textContent===text);
const input=text=>[...container.querySelectorAll('label')].find(l=>l.textContent.startsWith(text)).querySelector('input');
test('stock compares quantity, confirms, sends once and surfaces stale conflict',async()=>{
 api.mockResolvedValue({records:[{item_id:'1',name:'재료',quantity:5}],nextAfter:null});await act(async()=>root.render(<StorageAdminPanel/>));await act(async()=>button('재고 수정').click());await act(async()=>{Simulate.change(input('최종 재고'),{target:{value:'7'}});Simulate.change(input('수정 사유'),{target:{value:'정정'}});});
 expect(container.textContent).toContain('변경 전 5 → 변경 후 7');window.confirm.mockReturnValue(false);await act(async()=>Simulate.submit(container.querySelector('.admin-form')));expect(api.mock.calls.filter(c=>c[1]?.method==='PATCH')).toHaveLength(0);
 window.confirm.mockReturnValue(true);let reject;api.mockImplementation(()=>new Promise((r,j)=>{reject=j;}));await act(async()=>{Simulate.submit(container.querySelector('.admin-form'));Simulate.submit(container.querySelector('.admin-form'));});expect(api.mock.calls.filter(c=>c[1]?.method==='PATCH')).toHaveLength(1);expect(api).toHaveBeenLastCalledWith('/admin/storage/1',expect.objectContaining({body:expect.objectContaining({quantity:7,expectedQuantity:5,reason:'정정'})}));
 await act(async()=>reject(Object.assign(Error('다시 조회'),{code:'ADMIN_EDIT_CONFLICT'})));expect(container.textContent).toContain('ADMIN_EDIT_CONFLICT');
});
test('clue direct detail restores during initial load, preserves discovery read-only and version',async()=>{
 const record={id:'2',title:'단서',content:'내용',related_target:null,area_id:'1',is_public:false,is_discovered:true,first_discoverer_id:'9'};
 api.mockImplementation(async p=>p==='/admin/clues/2'?{record,version:'v1'}:p==='/admin/battle-areas'?{records:[{id:'1',name:'구역'}]}:{records:[]});await act(async()=>root.render(<ClueAdminPanel recordId="2" onOpen={()=>{}}/>));expect(input('제목').value).toBe('단서');expect(container.textContent).toContain('최초 발견자 ID 9');await act(async()=>Simulate.change(input('수정 사유'),{target:{value:'정정'}}));
 await act(async()=>Simulate.submit(container.querySelector('.admin-form')));const body=api.mock.calls.find(c=>c[1]?.method==='PATCH')[1].body;expect(body.expectedVersion).toBe('v1');expect(body.is_public).toBe(false);expect(body.is_discovered).toBeUndefined();expect(body.first_discoverer_id).toBeUndefined();
});
test('character detail edits preserve version and do not send HP or state',async()=>{
 const record={id:'1',hunter_grade:'B',has_ability:false,ability_grade:null,recipe_ids:[],daily_meal_count:0,daily_training_done:false,death_count:0,revive_count:0,hp:80,status:'ALIVE'};
 api.mockImplementation(async p=>p==='/admin/recipes'?{records:[]}: {record,version:'v1'});await act(async()=>root.render(<CharacterDetailsEditor id="1"/>));await act(async()=>Simulate.change(input('수정 사유'),{target:{value:'정정'}}));await act(async()=>Simulate.submit(container.querySelector('form')));expect(container.querySelector('select[required]')).toBeNull();const body=api.mock.calls.find(c=>c[1]?.method==='PATCH')[1].body;expect(body.expectedVersion).toBe('v1');expect(body.hp).toBeUndefined();expect(body.status).toBeUndefined();expect(container.textContent).toContain('상세 설정 저장 성공');
});
test('new admin screens propagate revoked authorization',async()=>{
 const denied=jest.fn();api.mockRejectedValue(Object.assign(Error('권한 없음'),{status:403}));await act(async()=>root.render(<StorageAdminPanel onDenied={denied}/>));expect(denied).toHaveBeenCalledWith('권한 없음');
});
