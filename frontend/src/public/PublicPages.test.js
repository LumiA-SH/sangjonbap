import {Editor} from '../admin/AdminPanel';
import {MasterEditor} from '../admin/MasterPanel';
import OperatingPolicyPanel from '../admin/OperatingPolicyPanel';
import StorageAdminPanel from '../admin/StorageAdminPanel';
import BalancePanel from '../admin/BalancePanel';
import AreaHubPanel from '../admin/AreaHubPanel';
import ItemPicker from '../admin/ItemPicker';
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
 const character={id:'2',name:'러너',hunter_grade:'A',has_ability:true,ability_grade:'B',status:'DEAD'};api.mockImplementation(async p=>p==='/public/characters/2'?{character}:p==='/characters/2/public'?{character:{...character,hp:0,blood:0},inventory:[]}:{records:[character]});const open=jest.fn(),back=jest.fn();await act(async()=>root.render(<CharacterDirectory onOpen={open} onBack={back}/>));await act(async()=>button('러너').click());expect(open).toHaveBeenCalledWith('2');await act(async()=>root.render(<CharacterDirectory recordId="2" onOpen={open} onBack={back} canReadDetails={false}/>));expect(div.textContent).toContain('헌터등급 A');expect(api.mock.calls.some(([p])=>p==='/characters/2/public')).toBe(false);await act(async()=>root.render(<CharacterDirectory recordId="2" onOpen={open} onBack={back} canReadDetails/>));expect(api).toHaveBeenCalledWith('/characters/2/public');expect(div.textContent).toContain('소지품');await act(async()=>button('목록으로 돌아가기').click());expect(back).toHaveBeenCalled();
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

test('admin item picker browses all pages and keeps the selected ID',async()=>{
 const change=jest.fn();api.mockImplementation(async p=>p.includes('after=30')?{records:[{id:'31',name:'다음 음식',category:'FOOD',is_active:true}],nextAfter:null}:p.includes('/items/search')?{records:[{id:'30',name:'기존 음식',category:'FOOD',is_active:true}],nextAfter:'30'}:{record:{id:'7',name:'현재 연결',category:'ETC'}});
 await act(async()=>root.render(<ItemPicker value="7" onChange={change}/>));
 await act(async()=>button('전체 목록 조회').click());expect(api).toHaveBeenCalledWith('/admin/items/search?q=');
 await act(async()=>button('다음 항목 더 보기').click());expect(div.textContent).toContain('다음 음식');expect(div.textContent).toContain('현재 연결');expect(change).not.toHaveBeenCalled();
 await act(async()=>[...div.querySelectorAll('button')].filter(x=>x.textContent==='선택').at(-1).click());expect(change).toHaveBeenCalledWith('31',expect.objectContaining({name:'다음 음식'}));
});
test('area hub switches management sections and shows save rejection below editor',async()=>{
 api.mockImplementation(async(p,o)=>{if(o?.method)throw Object.assign(Error('저장 거부'),{code:'SAVE_FAILED'});if(p==='/admin/areas')return {records:[{id:'1',name:'수몰구역'}]};if(p==='/admin/recipes')return {records:[]};if(p.endsWith('/results'))return {results:[],clues:[],areaRecipes:[]};if(p.endsWith('/monsters'))return {assignments:[],monsters:[]};return {record:{id:'1',name:'수몰구역',encounter_rate:40,is_open:false,sort_order:0}};});
 await act(async()=>root.render(<AreaHubPanel route={{area:'1'}} onDenied={jest.fn()}/>));expect(div.textContent).toContain('조사 결과·보상');
 await act(async()=>button('구역 설정').click());const name=[...div.querySelectorAll('input')].find(x=>x.value==='수몰구역');await act(async()=>Simulate.change(name,{target:{value:'수정 구역'}}));await act(async()=>Simulate.submit(div.querySelector('.area-hub-form')));expect(div.querySelector('.admin-detail-pane .area-hub-feedback').textContent).toContain('SAVE_FAILED');
 expect(api).toHaveBeenCalledWith('/admin/areas/1',expect.objectContaining({method:'PATCH',body:expect.objectContaining({name:'수정 구역'})}));
});

test('storage list opens adjacent editor and preserves quantity conflict guard',async()=>{
 api.mockResolvedValue({records:[{item_id:'7',name:'재료',quantity:4}],nextAfter:null});
 await act(async()=>root.render(<StorageAdminPanel onDenied={jest.fn()}/>));
 const row=div.querySelector('.admin-storage-list button');await act(async()=>row.click());
 const form=div.querySelector('.admin-detail-pane form');expect(form.textContent).toContain('변경 전 4');
 await act(async()=>Simulate.change(form.querySelector('input[type=number]'),{target:{value:'6'}}));
 await act(async()=>Simulate.change(form.querySelector('input[maxlength]'),{target:{value:'검수'}}));
 await act(async()=>Simulate.submit(form));
 expect(api).toHaveBeenCalledWith('/admin/storage/7',expect.objectContaining({method:'PATCH',body:expect.objectContaining({quantity:6,expectedQuantity:4,reason:'검수'})}));
});
test('balance groups retain every existing editable setting',async()=>{
 api.mockResolvedValue({settings:{}});await act(async()=>root.render(<BalancePanel onDenied={jest.fn()}/>));
 expect([...div.querySelectorAll('legend')].map(e=>e.textContent)).toEqual(['치료','조사 · 요리','일일훈련']);
 expect(div.querySelectorAll('input[type=number]')).toHaveLength(11);
});

test('empty system guide opens an unpublished textarea without saving automatically',async()=>{
 api.mockResolvedValue({content:{items:[]},version:1});await act(async()=>root.render(<ContentAdminPanel kind="system"/>));
 expect(div.querySelector('textarea')).not.toBeNull();expect(div.querySelector('textarea').value).toBe('');expect(div.querySelector('input[type="checkbox"]').checked).toBe(false);expect(api).toHaveBeenCalledTimes(1);
});

test('announcement editor offers disabled dice policy without changing persisted legacy settings',async()=>{
 const onDenied=jest.fn();api.mockResolvedValueOnce({settings:{enabled:false,stages:[]}});
 await act(async()=>root.render(<OperatingPolicyPanel onDenied={onDenied}/>));
 const legacy={events:{death:{enabled:false,template:'{character} 사망',visibility:null,deduplicate:true,retryEnabled:false,maxAttempts:null,retryMinutes:null,thresholds:[]}}};
 api.mockResolvedValueOnce({settings:legacy});await act(async()=>button('시스템 공지 정책').click());
 expect(div.textContent).toContain('1D100 결과');expect(legacy.events.dice).toBeUndefined();
 const field=[...div.querySelectorAll('fieldset')].find(f=>f.querySelector('legend')?.textContent==='1D100 결과');expect(field.querySelector('input[type="checkbox"]').checked).toBe(false);
 expect(api.mock.calls.every(c=>!c[1]?.method)).toBe(true);
});


test('food detail name is first and save preserves linked item and RP',async()=>{
 const record={id:'7',item_id:'9',name:'기존 음식',blood_recovery:10,is_failure:true,rp_effect_text:'기존 문구',rp_effect_texts:['첫 문구']};
 api.mockImplementation(async(p,o)=>o?.method?{record}:{records:[],record:{id:'9',name:'기존 음식'}});
 await act(async()=>root.render(<MasterEditor kind="foods" record={record} onSaved={jest.fn()} onDenied={jest.fn()} onBusy={jest.fn()}/>));
 const first=div.querySelector('.admin-editor-section input');expect(first.value).toBe('기존 음식');
 expect(div.querySelector('.admin-editor-section h4').textContent).toBe('음식 기본 정보');
 expect(div.textContent).toContain('실패요리 RP 효과');expect(div.querySelector('.admin-editor-reference').open).toBe(false);
 await act(async()=>Simulate.change(first,{target:{value:'수정 음식'}}));await act(async()=>Simulate.submit(div.querySelector('form')));
 const saved=api.mock.calls.find(c=>c[1]?.method==='PATCH');expect(saved[0]).toBe('/admin/foods/7');
 expect(saved[1].body).toEqual(expect.objectContaining({name:'수정 음식',rp_effect_text:'기존 문구',rp_effect_texts:['첫 문구']}));expect(saved[1].body).not.toHaveProperty('item_id');
});

test('item detail sections preserve editing and keep deletion in the heading',async()=>{
 const record={id:'71',name:'긴 이름 아이템',category:'MATERIAL'};api.mockResolvedValue({record});
 await act(async()=>root.render(<Editor kind="items" record={record} onSaved={jest.fn()} onDenied={jest.fn()} deleteControl={<button type="button">삭제</button>}/>));
 expect([...div.querySelectorAll('.admin-editor-section h4')].map(x=>x.textContent)).toEqual(['아이템 기본 정보','사용 · 이동 설정','아이템 효과']);
 expect(div.querySelector('.admin-editor-heading button').textContent).toBe('삭제');
 const name=div.querySelector('.admin-editor-section input');expect(name.value).toBe('긴 이름 아이템');
 await act(async()=>Simulate.change(name,{target:{value:'변경 아이템'}}));await act(async()=>Simulate.submit(div.querySelector('form')));
 expect(api).toHaveBeenCalledWith('/admin/items/71',expect.objectContaining({method:'PATCH',body:expect.objectContaining({name:'변경 아이템',category:'MATERIAL'})}));
 expect(div.querySelector('.admin-editor-footer [role=status]')).not.toBeNull();
});
import {toKstInput,fromKstInput} from '../admin/kstDateTime';
test('area date input uses KST independent of browser timezone',async()=>{
 expect(toKstInput('2026-11-15T15:00:00Z')).toBe('2026-11-16T00:00:00');
 expect(fromKstInput('2026-11-16T00:00')).toBe('2026-11-16T00:00:00+09:00');
 expect(fromKstInput('')).toBeNull();
 api.mockResolvedValue({records:[]});
 await act(async()=>root.render(<MasterEditor kind="areas" record={null} onSaved={jest.fn()} onDenied={jest.fn()} onBusy={jest.fn()}/>));
 expect(div.querySelector('input[type="datetime-local"]')).not.toBeNull();
 expect(div.textContent).toContain('지정 시각에 예약 공개');
});
