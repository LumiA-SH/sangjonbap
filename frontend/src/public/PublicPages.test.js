import BattlePanel from '../dev/BattlePanel';
import EventFeed from './EventFeed';
import EventAdminPanel from '../admin/EventAdminPanel';
import {subscribeSystemFeed} from './systemFeedUpdates';
jest.mock('./systemFeedUpdates',()=>({subscribeSystemFeed:jest.fn(()=>()=>{})}));
import BattleAdminPanel from '../admin/BattleAdminPanel';
import RequestLoading from '../api/RequestLoading';
import ShopPanel from '../dev/ShopPanel';
import GachaStockEditor from '../admin/GachaStockEditor';
import ClueAdminPanel from '../admin/ClueAdminPanel';
import {displayLabel} from '../features/displayLabels';
import RolePanel from '../admin/RolePanel';
import {itemCategoryLabel} from '../features/itemCategory';
import ImageUploadField from '../admin/ImageUploadField';
import {adminMenuGroups} from '../admin/navigation';
import {actionLabel,actionSummary} from '../dev/recordSummary';
import {Editor} from '../admin/AdminPanel';
import {MasterEditor} from '../admin/MasterPanel';
import OperatingPolicyPanel from '../admin/OperatingPolicyPanel';
import StorageAdminPanel from '../admin/StorageAdminPanel';
import BalancePanel,{FoodGradeSettings} from '../admin/BalancePanel';
import AreaHubPanel,{AreaDiscoveryPanel} from '../admin/AreaHubPanel';
import ItemPicker from '../admin/ItemPicker';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import GuidePage,{kst} from './GuidePage';
import CharacterDirectory from './CharacterDirectory';
import AnemiaNotice,{anemiaText,AnemiaPolicyContext} from './AnemiaNotice';
import ContentAdminPanel from '../admin/ContentAdminPanel';
import {api,subscribeApiPending} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn(),subscribeApiPending:jest.fn()}));
let div,root;beforeEach(()=>{subscribeSystemFeed.mockImplementation(()=>()=>{});global.IS_REACT_ACT_ENVIRONMENT=true;api.mockReset();window.confirm=jest.fn(()=>true);Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});div=document.createElement('div');root=createRoot(div);});afterEach(async()=>{await act(async()=>root.unmount());});
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
 await act(async()=>root.render(<AreaHubPanel route={{area:'1'}} onDenied={jest.fn()}/>));expect(div.textContent).toContain('조사 결과');
 await act(async()=>button('기본 정보').click());const name=[...div.querySelectorAll('input')].find(x=>x.value==='수몰구역');await act(async()=>Simulate.change(name,{target:{value:'수정 구역'}}));await act(async()=>Simulate.submit(div.querySelector('.area-hub-form')));expect(div.querySelector('.admin-detail-pane .area-hub-feedback').textContent).toContain('SAVE_FAILED');
 expect(api).toHaveBeenCalledWith('/admin/areas/1',expect.objectContaining({method:'PATCH',body:expect.objectContaining({name:'수정 구역'})}));
});

test('storage edits quantity inline and preserves quantity conflict guard',async()=>{
 api.mockResolvedValue({records:[{item_id:'7',name:'재료',quantity:4}],nextAfter:null});
 await act(async()=>root.render(<StorageAdminPanel onDenied={jest.fn()}/>));
 const form=div.querySelector('.admin-storage-form');expect(div.querySelector('.admin-detail-pane')).toBeNull();
 await act(async()=>Simulate.change(form.querySelector('input[type=number]'),{target:{value:'6'}}));
 expect(form.textContent).toContain('변경 전 4');
 await act(async()=>Simulate.change(form.querySelector('input[maxlength]'),{target:{value:'검수'}}));
 await act(async()=>Simulate.submit(form));
 expect(api).toHaveBeenCalledWith('/admin/storage/7',expect.objectContaining({method:'PATCH',body:expect.objectContaining({quantity:6,expectedQuantity:4,reason:'검수'})}));
});
test('balance groups retain every existing editable setting',async()=>{
 api.mockResolvedValue({settings:{}});await act(async()=>root.render(<BalancePanel initialTab="actions" onDenied={jest.fn()}/>));
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
 expect(div.textContent).toContain('실패요리 RP 효과');expect(div.querySelector('.admin-editor-reference')).toBeNull();
 await act(async()=>Simulate.change(first,{target:{value:'수정 음식'}}));await act(async()=>Simulate.submit(div.querySelector('form')));
 const saved=api.mock.calls.find(c=>c[1]?.method==='PATCH');expect(saved[0]).toBe('/admin/foods/7');
 expect(saved[1].body).toEqual(expect.objectContaining({name:'수정 음식',rp_effect_text:null,rp_effect_texts:['첫 문구']}));expect(saved[1].body).not.toHaveProperty('item_id');
});

test('item detail sections preserve editing and keep deletion in the heading',async()=>{
 const record={id:'71',name:'긴 이름 아이템',category:'MATERIAL'};api.mockResolvedValue({record});
 await act(async()=>root.render(<Editor kind="items" record={record} onSaved={jest.fn()} onDenied={jest.fn()} deleteControl={<button type="button">삭제</button>}/>));
 expect([...div.querySelectorAll('.admin-editor-section h4')].map(x=>x.textContent)).toEqual(['아이템 기본 정보','사용 및 운영 설정']);
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

test('action record summaries distinguish midnight interruption and retain legacy fallback',()=>{
 expect(actionLabel({action_type:'DAILY_TRAINING'})).toBe('일일훈련');
 expect(actionSummary({action_type:'BATTLE_MIDNIGHT_INTERRUPTED',detail:{before:{hp:30},after:{hp:30}}})).toContain('자정 중단');
 expect(actionSummary({detail:{monsterName:'마물',battleStatus:'VICTORY',currencyReward:2,rewards:[{name:'재료',quantity:1}]}})).toContain('재료 ×1');
 expect(actionSummary({description:'과거 기록'})).toBe('과거 기록');
});
import SystemFeed from './SystemFeed';
test('System posts use actual text, same-category more link, KST and safe rendering',async()=>{
 const more=jest.fn();api.mockResolvedValue({enabled:true,records:[{id:'9',text:'<img src=x onerror=alert(1)>\n실제 소식',createdAt:'2026-11-15T00:00:00Z',url:'https://survival-bob.site/@System/9'}],nextBefore:'9'});
 await act(async()=>root.render(<SystemFeed kind="activity" preview onMore={more}/>));expect(api).toHaveBeenCalledWith('/public/system-feed?kind=activity');expect(div.textContent).toContain('실제 소식');expect(div.textContent).toContain('KST');expect(div.querySelector('img')).toBeNull();await act(async()=>button('더보기 ›').click());expect(more).toHaveBeenCalledTimes(1);
 await act(async()=>root.render(<SystemFeed key="full" kind="activity"/>));await act(async()=>button('이전 게시글').click());expect(api).toHaveBeenCalledWith('/public/system-feed?kind=activity&before=9');
});
test('System feed distinguishes disabled, empty, error and retry states',async()=>{
 api.mockResolvedValue({enabled:false,records:[],nextBefore:null});await act(async()=>root.render(<SystemFeed/>));expect(div.textContent).toContain('연동 준비 중');
 api.mockRejectedValueOnce(Error('연결 실패'));await act(async()=>root.render(<SystemFeed key="error"/>));expect(div.querySelector('[role=alert]').textContent).toContain('연결 실패');api.mockResolvedValue({enabled:true,records:[],nextBefore:null});await act(async()=>button('다시 불러오기').click());expect(div.textContent).toContain('표시할 게시글이 없습니다');
});
import RecordsPanel from '../dev/RecordsPanel';
import {readLocation} from '../admin/navigation';
test('feed navigation survives URL reload and personal records refresh when returning to the tab',async()=>{
 const old=window.location.hash;for(const kind of ['activity','notice','event']){window.location.hash='#game/feed-'+kind;expect(readLocation().tab).toBe('feed-'+kind);}window.location.hash=old;
 api.mockResolvedValue({records:[],nextBefore:null});await act(async()=>root.render(<RecordsPanel active={false}/>));expect(api).not.toHaveBeenCalled();await act(async()=>root.render(<RecordsPanel active/>));expect(api).toHaveBeenCalledWith('/records/action-logs');const n=api.mock.calls.length;
 await act(async()=>root.render(<RecordsPanel active={false}/>));await act(async()=>root.render(<RecordsPanel active/>));expect(api.mock.calls.length).toBe(n+1);
});
test('record summaries show batch outcomes and historical combat results without changing logs',()=>{
 const batch={action_type:'COOK',detail:{successCount:2,failureCount:1,outputs:[{name:'음식',quantity:6},{name:'실패 음식',quantity:1}]}};
 expect(actionSummary(batch)).toContain('요리 성공 2회 · 실패 1회');expect(actionSummary(batch)).toContain('음식 ×6');
 const combat={action_type:'BATTLE_COMMAND',detail:{before:{hp:70},resolved:{status:'FLED',fledActor:'MONSTER',hp:65}}};
 const saved=JSON.stringify(combat);expect(actionSummary(combat)).toContain('마물 도주');expect(actionSummary(combat)).toContain('HP 70 → 65');expect(JSON.stringify(combat)).toBe(saved);
 expect(actionSummary({action_type:'BATTLE_MIDNIGHT_INTERRUPTED',detail:{monsterName:'마물',before:{hp:70,ap:1},after:{hp:70,ap:10}}})).toContain('상대: 마물');
});

test('reference layout preserves admin role menu and item active toggle payload',async()=>{
 expect(adminMenuGroups.some(group=>group.menus.includes('users'))).toBe(true);
 const saved=jest.fn();api.mockResolvedValue({record:{id:'1'}});
 await act(async()=>root.render(<Editor kind="items" record={{id:'1',name:'재료',category:'MATERIAL',is_active:true}} onSaved={saved} onDenied={jest.fn()}/>));
 const toggle=div.querySelector('.admin-editor-heading input[type="checkbox"]');expect(toggle.checked).toBe(true);
 await act(async()=>Simulate.change(toggle,{target:{checked:false}}));
 await act(async()=>Simulate.submit(div.querySelector('form')));
 expect(api.mock.calls.find(([url])=>url==='/admin/items/1')[1].body.is_active).toBe(false);
});
test('image preview keeps an empty state and handles broken image without removing its value',async()=>{
 const changed=jest.fn();await act(async()=>root.render(<ImageUploadField label="음식 이미지" kind="foods" value={null} onChange={changed}/>));
 expect(div.querySelector('.admin-image-preview').textContent).toContain('등록된 이미지 없음');
 await act(async()=>root.render(<ImageUploadField label="음식 이미지" kind="foods" value="https://example.invalid/image.png" onChange={changed}/>));
 await act(async()=>Simulate.error(div.querySelector('img')));
 expect(div.textContent).toContain('이미지를 불러올 수 없습니다');expect(changed).not.toHaveBeenCalled();
});

test('food grades are managed inside common balance with existing APIs and admin menu retained',async()=>{
 api.mockImplementation(async path=>path==='/admin/balance'?{settings:{}}:{records:[],nextAfter:null});
 await act(async()=>root.render(<BalancePanel onDenied={jest.fn()}/>));
 await act(async()=>button('음식 등급별 효과').click());
 expect(api).toHaveBeenCalledWith('/admin/food-grades');
 expect(div.querySelector('[aria-label="음식 등급별 공통 효과"]')).not.toBeNull();
 expect(adminMenuGroups.some(g=>g.menus.includes('food-grades'))).toBe(false);
 expect(adminMenuGroups.some(g=>g.menus.includes('users'))).toBe(true);
 await act(async()=>button('행동 밸런스').click());
 expect(div.querySelectorAll('input[type=number]')).toHaveLength(11);
});

test('food balance shows all grades inline and saves only changed values through existing API',async()=>{
 const grades=[{id:'1',name:'일반',blood_recovery:10,stat_growth_rate:'15',is_active:true},{id:'2',name:'희귀',blood_recovery:20,stat_growth_rate:'20',is_active:true}];
 api.mockImplementation(async (path,options)=>options?{record:{...grades[0],...options.body}}:{records:grades,nextAfter:null});
 await act(async()=>root.render(<FoodGradeSettings onDenied={jest.fn()}/>));
 expect(div.querySelectorAll('tbody tr')).toHaveLength(2);expect(div.querySelector('.admin-record-workspace')).toBeNull();
 await act(async()=>Simulate.change(div.querySelector('[aria-label="일반 혈량 회복량"]'),{target:{value:'12'}}));
 await act(async()=>Simulate.submit(div.querySelector('form')));
 expect(api).toHaveBeenCalledWith('/admin/food-grades/1',expect.objectContaining({method:'PATCH',body:expect.objectContaining({blood_recovery:12,stat_growth_rate:15,is_active:true})}));
 expect(api.mock.calls.filter(([,o])=>o?.method==='PATCH')).toHaveLength(1);
 expect(div.textContent).toContain('1건 저장 완료');
});
test('food grade partial save reports completed rows and preserves remaining edits on denial',async()=>{
 const grades=[{id:'1',name:'일반',blood_recovery:10,stat_growth_rate:15,is_active:true},{id:'2',name:'희귀',blood_recovery:20,stat_growth_rate:20,is_active:true}];const denied=jest.fn();
 api.mockImplementation(async (path,options)=>{if(!options)return {records:grades,nextAfter:null};if(path.endsWith('/2'))throw Object.assign(Error('권한 없음'),{status:403});return {record:{...grades[0],...options.body}};});
 await act(async()=>root.render(<FoodGradeSettings onDenied={denied}/>));
 for(const name of ['일반','희귀'])await act(async()=>Simulate.change(div.querySelector('[aria-label="'+name+' 혈량 회복량"]'),{target:{value:'25'}}));
 await act(async()=>Simulate.submit(div.querySelector('form')));
 expect(div.textContent).toContain('1건 저장 완료 · 나머지 저장 실패');expect(denied).toHaveBeenCalled();expect(div.querySelector('[aria-label="희귀 혈량 회복량"]').value).toBe('25');
});

test('item categories show Korean labels while preserving stored API codes',async()=>{
 expect(['MATERIAL','CONSUMABLE','FOOD','ETC'].map(itemCategoryLabel)).toEqual(['재료','소모품','음식','기타']);
 api.mockResolvedValue({record:{id:'1'}});
 await act(async()=>root.render(<Editor kind="items" record={{id:'1',name:'나무',category:'MATERIAL',is_active:true}} onSaved={jest.fn()} onDenied={jest.fn()}/>));
 const category=[...div.querySelectorAll('select')].find(select=>select.querySelector('option[value="MATERIAL"]'));
 expect(category.value).toBe('MATERIAL');expect([...category.options].map(o=>o.textContent)).toEqual(['재료','소모품','음식','기타']);
 await act(async()=>Simulate.change(category,{target:{value:'ETC'}}));
 await act(async()=>Simulate.submit(div.querySelector('form')));
 expect(api).toHaveBeenCalledWith('/admin/items/1',expect.objectContaining({body:expect.objectContaining({category:'ETC'})}));
});

test('admin use target and effects display Korean without changing stored values',async()=>{
 api.mockResolvedValue({record:{id:'8'}});
 await act(async()=>root.render(<Editor kind="items" record={{id:'8',name:'혈액팩',category:'CONSUMABLE',effect_type:'BLOOD_PACK',blood_pack_kind:'STANDARD',effect_value:30,usable:true,use_target:'SELF',battle_usable:true,is_active:true}} onSaved={jest.fn()} onDenied={jest.fn()}/>));
 expect(div.querySelector('input[readonly]').value).toBe('자신');
 expect(div.querySelector('option[value="BLOOD_PACK"]').textContent).toBe('혈액팩');
 await act(async()=>Simulate.submit(div.querySelector('form')));
 expect(api).toHaveBeenCalledWith('/admin/items/8',expect.objectContaining({body:expect.objectContaining({use_target:'SELF',effect_type:'BLOOD_PACK'})}));
 expect(displayLabel('battle_ability_s_ap_cost')).toBe('S등급 이능 AP 비용');
 expect(displayLabel('SPECIAL_ATTACK')).toBe('특수 공격');
 expect(displayLabel('HOLD')).toBe('보류');
});
test('role display and confirmation are translated while authorization payload stays coded',async()=>{
 api.mockResolvedValue({records:[{id:'12',role:'USER',is_active:true,character_name:'러너',game_test_enabled:false}]});
 await act(async()=>root.render(<RolePanel onDenied={jest.fn()}/>));
 await act(async()=>Simulate.submit(div.querySelector('form')));
 expect(div.textContent).toContain('일반 사용자');
 await act(async()=>button('관리자 지정').click());
 expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('일반 사용자 → 관리자'));
 expect(api).toHaveBeenCalledWith('/admin/users/12/role',expect.objectContaining({body:expect.objectContaining({role:'ADMIN'})}));
});

test('food creation needs only food fields and legacy RP has one editable field',async()=>{
 api.mockImplementation(async(path,options)=>options?{record:{item_id:'91'}}:{records:[],nextAfter:null});
 await act(async()=>root.render(<MasterEditor kind="foods" record={{name:'실패 음식',is_failure:true,rp_effect_text:'기존 문구'}} onSaved={jest.fn()} onDenied={jest.fn()} onBusy={jest.fn()}/>));
 expect(div.textContent).not.toContain('연결 아이템 선택');
 const rp=[...div.querySelectorAll('label')].find(l=>l.textContent.includes('RP')&&l.querySelector('textarea'));
 expect(rp.querySelector('textarea').value).toBe('기존 문구');
 expect(div.querySelectorAll('textarea')).toHaveLength(2);
 const description=[...div.querySelectorAll('label')].find(l=>l.textContent.trim()==='설명');
 await act(async()=>Simulate.change(description.querySelector('textarea'),{target:{value:'음식 설명'}}));
 await act(async()=>Simulate.submit(div.querySelector('form')));
 const body=api.mock.calls.find(([,o])=>o?.method)[1].body;
 expect(body.item_id).toBeUndefined();expect(body.rp_effect_texts).toEqual(['기존 문구']);expect(body.rp_effect_text).toBeNull();expect(body.description).toBe('음식 설명');
});

test('clue editor permits no area and separates manual publication from discovery',async()=>{
 api.mockImplementation(async(path,o)=>{if(o)return {record:{id:'21',...o.body,is_discovered:false},version:'v'};return {records:[],nextAfter:null};});
 await act(async()=>root.render(<ClueAdminPanel recordId="new" onOpen={jest.fn()} onDenied={jest.fn()}/>));
 const select=div.querySelector('select');expect(select.required).toBe(false);expect(select.value).toBe('');
 expect(div.textContent).toContain('미발견 (신규 단서)');
 const form=div.querySelector('.admin-form');
 await act(async()=>Simulate.change(form.querySelector('input[maxlength="100"]'),{target:{value:'단서'}}));
 await act(async()=>Simulate.change(form.querySelector('input[maxlength="500"]'),{target:{value:'직접 공개'}}));
 await act(async()=>Simulate.change(form.querySelectorAll('input[type=checkbox]')[1],{target:{checked:true}}));
 await act(async()=>Simulate.submit(form));
 expect(api).toHaveBeenCalledWith('/admin/clues',expect.objectContaining({method:'POST',body:expect.objectContaining({area_id:null,manually_published:true})}));
});

test('admin logs separate server categories and keep filters while paging',async()=>{
 api.mockResolvedValue({records:[{id:'31',category:'COOKING',action_type:'COOK',description:'요리 완료',detail:{result:'ok'}}],nextBefore:'31',categories:[{category:'COOKING',count:'42'},{category:'ADMIN',count:'3'}]});
 await act(async()=>root.render(<RecordsPanel admin onDenied={jest.fn()}/>));
 const tab=[...div.querySelectorAll('[role=tab]')].find(b=>b.textContent.startsWith('요리'));
 expect(tab.textContent).toContain('42');
 await act(async()=>tab.click());
 expect(api).toHaveBeenLastCalledWith('/admin/action-logs?category=COOKING');
 await act(async()=>Simulate.change(div.querySelector('.admin-log-search input'),{target:{value:'러너'}}));
 await act(async()=>Simulate.submit(div.querySelector('.admin-log-search')));
 expect(api.mock.calls.at(-1)[0]).toContain('category=COOKING&q=');
 await act(async()=>button('이전 기록 30건').click());
 expect(api.mock.calls.at(-1)[0]).toContain('&before=31');
 expect(div.textContent).toContain('상세 JSON');
});

test('area discovery is a read-only expandable status table and links to area management',async()=>{
 const manage=jest.fn();
 api.mockImplementation(async path=>path==='/admin/areas'?{records:[{id:'1',name:'수몰구역',investigation_rate:50}]}:path.endsWith('/results')?{results:[{id:'2',result_text:'고유 단서',is_unique:true,is_active:true,discovery:null}],areaRecipes:[{recipe_id:'3',recipe_name:'수프',discovered:true}],clues:[]}:{assignments:[{monster_id:'4',name:'박쥐',is_active:true,discovered:true}]});
 await act(async()=>root.render(<AreaDiscoveryPanel onDenied={jest.fn()} onManage={manage}/>));
 expect(div.textContent).toContain('50%');
 expect(div.querySelector('.area-discovery-zone')).not.toBeNull();
 await act(async()=>div.querySelector('[aria-expanded]').click());
 expect(div.textContent).toContain('고유 단서');expect(div.textContent).toContain('미발견');expect(div.textContent).toContain('박쥐');
 await act(async()=>button('이 구역 관리').click());expect(manage).toHaveBeenCalledWith('1');
 expect(api.mock.calls.every(([,options])=>!options)).toBe(true);
});
test('area result editor separates ordinary and unique results while preserving inline editing',async()=>{
 api.mockImplementation(async path=>path==='/admin/areas'?{records:[{id:'1',name:'지역'}]}:path==='/admin/recipes'?{records:[]}:path.endsWith('/results')?{results:[{id:'2',result_text:'일반 문구',is_unique:false,is_active:true,weight:1,rewards:[]},{id:'3',result_text:'고유 문구',is_unique:true,is_active:true,weight:1,rewards:[],discovery:{}}],clues:[],areaRecipes:[]}:path.endsWith('/monsters')?{assignments:[],monsters:[]}:{record:{id:'1',name:'지역'}});
 await act(async()=>root.render(<AreaHubPanel route={{area:'1'}} onDenied={jest.fn()}/>));
 await act(async()=>button('조사 결과').click());expect(div.querySelectorAll('.area-result-group')).toHaveLength(2);
 const toggle=[...div.querySelectorAll('.area-result-group button')].find(b=>b.textContent.includes('고유 문구'));
 await act(async()=>toggle.click());expect(toggle.getAttribute('aria-expanded')).toBe('true');expect(div.querySelector('.area-hub-inline-form')).not.toBeNull();
});

test('gacha reward picker searches all item types instead of RP-only items',async()=>{
 api.mockResolvedValue({records:[{id:'801',name:'회복 음식',category:'FOOD',is_food:true},{id:'802',name:'회복약',category:'CONSUMABLE'},{id:'803',name:'재료',category:'MATERIAL'},{id:'804',name:'기념품',category:'ETC'}]});
 await act(async()=>root.render(<GachaStockEditor onSaved={jest.fn()} onDenied={jest.fn()} onBusy={jest.fn()}/>));
 await act(async()=>button('보상 추가').click());await act(async()=>button('전체 목록 조회').click());
 expect(api).toHaveBeenCalledWith('/admin/items/search?q=');expect(api.mock.calls.some(([url])=>url.includes('rp=true'))).toBe(false);
 for(const name of ['회복 음식','회복약','재료','기념품'])expect(div.textContent).toContain(name);
});

test('embedded management pages do not duplicate the shell title and clue names open details',async()=>{
 const opened=jest.fn();api.mockResolvedValue({records:[{id:'8',title:'발견 단서',name:'구역',is_discovered:false,is_public:true}]});
 await act(async()=>root.render(<ClueAdminPanel onOpen={opened} onDenied={jest.fn()}/>));
 expect(div.querySelector('h2')).toBeNull();expect(button('단서 상세')).toBeUndefined();
 await act(async()=>button('발견 단서').click());expect(opened).toHaveBeenCalledWith('8');
 api.mockResolvedValue({settings:{},records:[]});
 await act(async()=>root.render(<BalancePanel onDenied={jest.fn()}/>));expect(div.querySelector('h2')).toBeNull();
});


test('recipe ingredient picker is material-only and cannot add a sixth field',async()=>{
 api.mockResolvedValue({records:[]});
 await act(async()=>root.render(<MasterEditor kind="recipes" record={null} onSaved={jest.fn()} onDenied={jest.fn()} onBusy={jest.fn()}/>));
 const add=()=>[...div.querySelectorAll('button')].find(b=>b.textContent.trim()==='행 추가');
 for(let i=0;i<5;i++) await act(async()=>Simulate.click(add()));
 expect(add().disabled).toBe(true);
 expect(div.querySelectorAll('.admin-child-row')).toHaveLength(5);
 const search=[...div.querySelector('.admin-child-row').querySelectorAll('button')].find(b=>b.textContent.includes('전체 목록'));
 await act(async()=>Simulate.click(search));
 expect(api.mock.calls.some(([url])=>url.includes('type=material'))).toBe(true);
});


test('character detail tabs retain draft values and show the profile',async()=>{
 const CharacterOperationsPanel=(await import('../admin/CharacterOperationsPanel')).default;
 const character={id:'1',name:'확인 캐릭터',hp:100,blood:80,ap:10,currency:1,atk:12,def:12,agi:12,status:'ALIVE',initial_setup_complete:true};
 api.mockImplementation(async path=>path.endsWith('/details')?{record:{hunter_grade:'B',has_ability:false,ability_grade:null,recipe_ids:[],daily_meal_count:0,daily_training_done:false,death_count:0,revive_count:0},version:'1'}:path==='/admin/recipes'?{records:[]}:{character,inventory:[]});
 await act(async()=>root.render(<CharacterOperationsPanel recordId="1" onOpen={jest.fn()} onDenied={jest.fn()}/>));
 expect(div.querySelector('.admin-character-detail-heading img')).not.toBeNull();
 const hp=div.querySelector('.admin-character-resources input');
 await act(async()=>{hp.value='90';Simulate.change(hp);});
 const tab=label=>[...div.querySelectorAll('.admin-detail-tabs button')].find(b=>b.textContent===label);
 await act(async()=>tab('인벤토리').click());expect(div.querySelector('.admin-character-resources').closest('[hidden]')).not.toBeNull();
 await act(async()=>tab('기본 정보').click());expect(hp.value).toBe('90');
 expect(api.mock.calls.every(([,options])=>!options)).toBe(true);
});


test('shop recipe preview shows ingredients and output without purchasing',async()=>{
 await act(async()=>root.render(<ShopPanel products={[{id:'1',recipe_id:'2',name:'조리법',price:2,recipe_detail:{ingredients:[{itemId:'3',name:'재료 A',quantity:2}],resultName:'완성 음식',resultQuantity:3}}]} character={{status:'ALIVE'}}/>));
 expect(div.textContent).toContain('재료 A ×2');expect(div.textContent).toContain('완성 음식 ×3');expect(api).not.toHaveBeenCalled();
});
test('archive displays discovered monsters and labels clue related area',async()=>{
 api.mockResolvedValue({records:[],nextBefore:null});await act(async()=>root.render(<RecordsPanel/>));
 api.mockResolvedValue({records:[{id:'3',title:'발견 마물',result_text:'발견 마물 최초 발견',character_name:'발견자'}],nextBefore:null});
 await act(async()=>[...div.querySelectorAll('button')].find(b=>b.textContent.includes('마물 최초 발견')).click());
 expect(api).toHaveBeenLastCalledWith('/records/monster-discoveries');expect(div.textContent).toContain('발견 마물');
 api.mockResolvedValue({records:[{id:'4',title:'단서',content:'내용',area_name:'관련 구역 A',is_discovered:true}],nextBefore:null});
 await act(async()=>[...div.querySelectorAll('button')].find(b=>b.textContent.includes('공개된 단서')).click());
 expect(div.textContent).toContain('관련 구역');expect(div.textContent).not.toContain('조사 지역');
});
test('temporary loading indicator delays display and clears after requests complete',async()=>{
 jest.useFakeTimers();let notify;const stop=jest.fn();subscribeApiPending.mockImplementation(fn=>{notify=fn;fn(0);return stop;});
 try{await act(async()=>root.render(<RequestLoading/>));
 await act(async()=>notify(1));expect(div.textContent).toBe('');
 await act(async()=>jest.advanceTimersByTime(400));expect(div.textContent).toContain('서버 응답');
 await act(async()=>notify(0));expect(div.textContent).toBe('');
 }finally{jest.useRealTimers();}
});


test('new monster defaults active while saved inactive monster stays inactive',async()=>{
 api.mockResolvedValue({records:[]});await act(async()=>root.render(<BattleAdminPanel recordId="new" onOpen={jest.fn()} onDenied={jest.fn()}/>));
 expect(div.querySelector('.admin-editor-toggle input').checked).toBe(true);
 api.mockResolvedValue({record:{id:'3',name:'비활성 마물',max_hp:1,atk:0,def:0,agi:0,is_active:false,actions:[],drops:[],areas:[]}});
 await act(async()=>root.render(<BattleAdminPanel recordId="3" onOpen={jest.fn()} onDenied={jest.fn()}/>));
 expect(div.querySelector('.admin-editor-toggle input').checked).toBe(false);
});
test('gacha table saves configured quantity and fixed weight with stock kept separate',async()=>{
 const saved=jest.fn();api.mockResolvedValue({record:{id:'1'}});
 await act(async()=>root.render(<GachaStockEditor record={{id:'1',name:'보급',rewards:[{id:'2',item_id:'4',name:'보상',quantity:3,weight:7,max_stock:5,remaining_stock:3,is_active:true}]}} onSaved={saved} onDenied={jest.fn()} onBusy={jest.fn()}/>));
 expect(div.querySelector('[aria-label="지급 수량"]').value).toBe('3');expect(div.querySelector('[aria-label="가중치"]').value).toBe('7');
 await act(async()=>Simulate.submit(div.querySelector('form')));
 const call=api.mock.calls.find(([,options])=>options?.method==='PATCH');
 expect(call[1].body.rewards[0]).toMatchObject({quantity:3,weight:7,max_stock:5,remaining_stock:3});expect(saved).toHaveBeenCalled();
});

test('reference item picker opens a dialog and closes after choosing without submitting the parent',async()=>{
 const change=jest.fn();api.mockResolvedValue({records:[{id:'9',name:'재료',category:'MATERIAL',is_active:true}]});
 await act(async()=>root.render(<ItemPicker onChange={change}/>));
 expect(div.querySelector('dialog').hasAttribute('open')).toBe(false);
 await act(async()=>div.querySelector('.admin-picker-trigger').click());
 expect(div.querySelector('dialog').hasAttribute('open')).toBe(true);
 await act(async()=>[...div.querySelectorAll('dialog button')].find(b=>b.textContent.trim()==='선택').click());
 expect(change).toHaveBeenCalledWith('9',expect.objectContaining({name:'재료'}));
 expect(div.querySelector('dialog').hasAttribute('open')).toBe(false);
 expect(api.mock.calls.some(([,o])=>o?.method)).toBe(false);
});

test('monster action dialog edits draft without saving until monster save',async()=>{
 api.mockResolvedValue({records:[],settings:{}});
 await act(async()=>root.render(<BattleAdminPanel recordId="new" onOpen={jest.fn()} onDenied={jest.fn()}/>));
 await act(async()=>[...div.querySelectorAll('button')].find(b=>b.textContent.startsWith('전투 행동 관리')).click());
 expect(div.querySelector('dialog').hasAttribute('open')).toBe(true);
 await act(async()=>[...div.querySelectorAll('dialog button')].find(b=>b.textContent==='행동 추가').click());
 expect(div.querySelectorAll('dialog fieldset')).toHaveLength(2);
 await act(async()=>[...div.querySelectorAll('dialog button')].find(b=>b.textContent==='편집 완료').click());
 expect(div.querySelector('dialog').hasAttribute('open')).toBe(false);
 expect(div.querySelector('.admin-action-summary').textContent).toBeTruthy();
 expect(api.mock.calls.some(([,o])=>o?.method)).toBe(false);
});

import NoticeFeed from './NoticeFeed';
test('notice preview and more use independent content and never call System',async()=>{
 const more=jest.fn();api.mockResolvedValue({content:{items:[{id:'n',title:'운영 공지',body:'공지 본문'}]}});
 await act(async()=>root.render(<NoticeFeed preview onMore={more}/>));
 expect(api).toHaveBeenCalledWith('/public/guides/notice');expect(api.mock.calls.some(([p])=>p.includes('system-feed'))).toBe(false);
 expect(div.textContent).toContain('운영 공지');expect(div.textContent).toContain('공지 본문');await act(async()=>button('더보기 ›').click());expect(more).toHaveBeenCalledTimes(1);
});
test('notice admin saves independent published content',async()=>{
 api.mockImplementation(async(p,o)=>o?{content:o.body.content,version:'new'}:{content:{items:[]},version:'old'});
 await act(async()=>root.render(<ContentAdminPanel kind="notice" onDenied={jest.fn()}/>));
 const title=div.querySelector('input[maxlength="100"]');await act(async()=>Simulate.change(title,{target:{value:'새 공지'}}));
 await act(async()=>Simulate.change(div.querySelector('textarea'),{target:{value:'본문'}}));
 await act(async()=>Simulate.change(div.querySelector('input[type=checkbox]'),{target:{checked:true}}));
 await act(async()=>Simulate.submit(div.querySelector('form')));
 expect(api).toHaveBeenCalledWith('/admin/content/notice',expect.objectContaining({method:'PATCH',body:expect.objectContaining({expectedVersion:'old',content:{items:[expect.objectContaining({title:'새 공지',body:'본문',published:true})]}})}));
});


test('recent feed updates on push without polling, retains content and coalesces changes',async()=>{
 jest.useFakeTimers();
 try{
  const page={enabled:true,revision:'one',records:[{id:'9',text:'기존 게시글',createdAt:'2026-11-15T00:00:00Z',url:'https://survival-bob.site/@System/9'}],nextBefore:null};
  api.mockResolvedValue(page);
  await act(async()=>root.render(<SystemFeed preview/>));expect(api).toHaveBeenCalledTimes(1);
  const signal=subscribeSystemFeed.mock.calls.at(-1)[0].onChange;
  await act(async()=>{jest.advanceTimersByTime(600000);window.dispatchEvent(new Event('focus'));});expect(api).toHaveBeenCalledTimes(1);
  api.mockResolvedValue({enabled:true,revision:'one'});
  await act(async()=>signal());expect(api).toHaveBeenCalledTimes(2);
  let finish;
  api.mockResolvedValueOnce({enabled:true,revision:'two'}).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>{signal();});expect(api).toHaveBeenCalledTimes(4);expect(div.textContent).toContain('기존 게시글');expect(div.textContent).not.toContain('게시글을 불러오는 중');
  await act(async()=>{signal();signal();});expect(api).toHaveBeenCalledTimes(4);
  api.mockResolvedValue({enabled:true,revision:'two'});
  await act(async()=>finish({...page,revision:'two'}));expect(api).toHaveBeenCalledTimes(5);
  await act(async()=>root.render(<SystemFeed preview active={false}/>));expect(div.textContent).not.toContain('기존 게시글');
 }finally{jest.useRealTimers();}
});

test('realtime signal joins, catches up, handles changes, heartbeats and cleans up',async()=>{
 jest.useFakeTimers();const sockets=[];
 class FakeSocket{constructor(url){this.url=url;sockets.push(this);this.send=jest.fn();this.close=jest.fn();}}
 const actual=jest.requireActual('./systemFeedUpdates'),changed=jest.fn(),error=jest.fn();
 api.mockResolvedValue({url:'wss://grkohfxvafbquhmgnvwj.supabase.co/realtime/v1/websocket',key:'public-fixture',table:'system_feed_signal'});
 const stop=actual.subscribeSystemFeed({onChange:changed,onError:error,Socket:FakeSocket});
 try{
  await act(async()=>{});const ws=sockets[0];ws.onopen();const join=JSON.parse(ws.send.mock.calls[0][0]);expect(join.payload.config.postgres_changes[0].table).toBe('system_feed_signal');
  ws.onmessage({data:JSON.stringify({event:'phx_reply',ref:join.ref,payload:{status:'ok'}})});expect(changed).toHaveBeenCalledTimes(1);
  ws.onmessage({data:JSON.stringify({topic:join.topic,event:'postgres_changes',payload:{data:{table:'system_feed_signal',type:'UPDATE',record:{revision:'opaque'}}}})});expect(changed).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(25000);expect(api).toHaveBeenCalledTimes(1);const hb=JSON.parse(ws.send.mock.calls.at(-1)[0]);expect(hb.event).toBe('heartbeat');
  ws.onmessage({data:JSON.stringify({event:'phx_reply',ref:hb.ref,payload:{status:'ok'}})});
  ws.onclose();await act(async()=>jest.advanceTimersByTime(1000));expect(sockets).toHaveLength(2);expect(api).toHaveBeenCalledTimes(1);
  stop();expect(sockets[1].close).toHaveBeenCalled();await act(async()=>jest.advanceTimersByTime(60000));expect(sockets).toHaveLength(2);
 }finally{stop();jest.useRealTimers();}
});


test('connection recovery clears its message independently and retry reconnects as well as reloads',async()=>{
 const retry=jest.fn(),stop=Object.assign(jest.fn(),{retry});subscribeSystemFeed.mockReturnValue(stop);
 api.mockResolvedValue({enabled:true,revision:'one',records:[],nextBefore:null});
 await act(async()=>root.render(<SystemFeed/>));const callbacks=subscribeSystemFeed.mock.calls.at(-1)[0];
 await act(async()=>callbacks.onError(Error('실시간 연결을 복구하고 있습니다.')));expect(div.textContent).toContain('실시간 연결을 복구');
 await act(async()=>button('다시 불러오기').click());expect(retry).toHaveBeenCalledTimes(1);
 expect(div.textContent).toContain('실시간 연결을 복구');
 await act(async()=>callbacks.onConnected());expect(div.textContent).not.toContain('실시간 연결을 복구');expect(div.textContent).not.toContain('다시 불러오기');
});

test('connection configuration errors keep their real message and do not endlessly retry',async()=>{
 jest.useFakeTimers();const actual=jest.requireActual('./systemFeedUpdates'),error=jest.fn();
 api.mockRejectedValue(Object.assign(Error('최근 기록 실시간 연결 설정을 확인하세요.'),{code:'SYSTEM_FEED_REALTIME_UNAVAILABLE',status:503}));
 const stop=actual.subscribeSystemFeed({onChange:jest.fn(),onError:error,Socket:jest.fn()});
 try{await act(async()=>{});expect(error.mock.calls[0][0].code).toBe('SYSTEM_FEED_REALTIME_UNAVAILABLE');await act(async()=>jest.advanceTimersByTime(60000));expect(api).toHaveBeenCalledTimes(1);stop.retry();await act(async()=>{});expect(api).toHaveBeenCalledTimes(2);}finally{stop();jest.useRealTimers();}
});

test('event banner opens detail, list cards open detail, detail returns to list',async()=>{
 const row={id:'1',title:'공개 행사',body:'첫 줄\n둘째 줄',imageUrl:null,createdAt:'2026-11-16T00:00:00Z',startAt:null,endAt:null};
 const open=jest.fn(),back=jest.fn();api.mockResolvedValue({record:row,records:[row]});
 await act(async()=>root.render(<EventFeed banner onOpen={open}/>));await act(async()=>Simulate.click(div.querySelector('.event-banner-link')));expect(open).toHaveBeenCalledWith('1');
 await act(async()=>root.render(<EventFeed onOpen={open}/>));await act(async()=>Simulate.click(div.querySelector('.public-event-card')));expect(open).toHaveBeenCalledTimes(2);
 await act(async()=>root.render(<EventFeed recordId="1" onBack={back}/>));expect(div.textContent).toContain('첫 줄');await act(async()=>Simulate.click(div.querySelector('button')));expect(back).toHaveBeenCalled();
 window.location.hash='#game/feed-event?record=1';expect(readLocation().record).toBe('1');window.location.hash='';
});
test('event admin uploads files and saves independently of notices',async()=>{
 api.mockResolvedValue({records:[],version:'v1'});const open=jest.fn();
 await act(async()=>root.render(<EventAdminPanel recordId="new" onOpen={open}/>));
 expect(div.querySelector('input[type=file]')).not.toBeNull();expect(div.querySelector('input[type=url]')).toBeNull();
 const title=div.querySelector('input[maxlength="100"]'),body=div.querySelector('textarea');
 await act(async()=>{Simulate.change(title,{target:{value:'이벤트 제목'}});Simulate.change(body,{target:{value:'본문'}});});
 window.confirm.mockReturnValue(true);api.mockResolvedValue({records:[],version:'v2',record:{id:'1'}});
 await act(async()=>Simulate.submit(div.querySelector('form')));
 expect(api).toHaveBeenLastCalledWith('/admin/events',expect.objectContaining({method:'POST',body:expect.objectContaining({expectedVersion:'v1',record:expect.objectContaining({title:'이벤트 제목',body:'본문'})})}));
 expect(open).toHaveBeenCalledWith('1');
});

test('event file upload previews, replaces and removes the image without an external URL field',async()=>{
 const previous=global.fetch,change=jest.fn();global.fetch=jest.fn(async()=>({ok:true}));
 try{
  api.mockResolvedValue({uploadUrl:'https://example.invalid/signed',imageUrl:'https://example.invalid/event.png'});
  await act(async()=>root.render(<ImageUploadField kind="events" value={null} onChange={change}/>));
  await act(async()=>Simulate.change(div.querySelector('input[type=file]'),{target:{files:[new File(['image'],'event.png',{type:'image/png'})],value:''}}));
  expect(api).toHaveBeenCalledWith('/admin/images/sign-upload',expect.objectContaining({body:expect.objectContaining({kind:'events',contentType:'image/png'})}));
  expect(global.fetch).toHaveBeenCalledWith('https://example.invalid/signed',expect.objectContaining({method:'PUT'}));
  expect(change).toHaveBeenCalledWith('https://example.invalid/event.png');
  await act(async()=>root.render(<ImageUploadField kind="events" value="https://example.invalid/event.png" onChange={change}/>));
  expect(div.querySelector('img').src).toContain('event.png');
  await act(async()=>root.render(<ImageUploadField kind="events" value="https://example.invalid/replaced.png" onChange={change}/>));
  expect(div.querySelector('img').src).toContain('replaced.png');await act(async()=>Simulate.click(button('이미지 제거')));expect(change).toHaveBeenLastCalledWith(null);
 }finally{global.fetch=previous;}
});

test('schedule only reloads on entry or explicit refresh, never polls', async () => {
 jest.useFakeTimers();
 try {
  api.mockResolvedValue({serverNow:'2026-11-16T00:00:00Z',content:{title:'일정',body:'',startAt:null,endAt:null,state:'UPCOMING',items:[]}});
  await act(async () => root.render(<GuidePage kind="schedule"/>));
  expect(api).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(30 * 60000));
  expect(api).toHaveBeenCalledTimes(1);
  expect(div.textContent).not.toContain('1분마다');
  await act(async () => Simulate.click(button('일정 새로고침')));
  expect(api).toHaveBeenCalledTimes(2);
 } finally {jest.useRealTimers();}
});

test('hidden battle skips initial and revision reads, entering battle fetches current state', async () => {
 api.mockResolvedValue({battle:null});
 const props={inventory:[],run:async f=>f(),refresh:async()=>{},busy:false};
 await act(async()=>root.render(<BattlePanel {...props} visible={false} revision={0}/>));
 await act(async()=>root.render(<BattlePanel {...props} visible={false} revision={1}/>));
 expect(api).not.toHaveBeenCalled();
 await act(async()=>root.render(<BattlePanel {...props} visible revision={1}/>));
 expect(api).toHaveBeenCalledTimes(1);
 expect(api).toHaveBeenCalledWith('/battles/latest');
 await act(async()=>root.render(<BattlePanel {...props} visible revision={2}/>));
 expect(api).toHaveBeenCalledTimes(2);
});
