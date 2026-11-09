import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {api,setToken} from './api/client';
jest.mock('./api/client',()=>({...jest.requireActual('./api/client'),api:jest.fn(),setToken:jest.fn()}));
let root,div;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;window.history.replaceState(null,"","/");window.confirm=jest.fn(()=>true);window.scrollTo=jest.fn();api.mockReset();setToken.mockReset();div=document.createElement('div');root=createRoot(div);});
afterEach(async()=>{await act(async()=>root.unmount());});
test('initial connection failure leaves loading state and retry restores provider',async()=>{
  api.mockRejectedValueOnce(Object.assign(new Error('연결 실패'),{code:'API_CONNECTION_FAILED'}));
  await act(async()=>root.render(<App/>));
  expect(div.textContent).not.toContain('인증 방식 확인 중');
  expect(div.textContent).toContain('연결 실패');
  expect(div.querySelector('input[type=password]')).toBeNull();
  api.mockResolvedValueOnce({provider:'dev'});
  await act(async()=>[...div.querySelectorAll('button')].find(b=>b.textContent==='연결 다시 시도').click());
  expect(div.querySelector('input[type=password]')).not.toBeNull();
});
test('verification denial never offers a bypass login',async()=>{
  api.mockRejectedValueOnce(Object.assign(new Error('key required'),{code:'VERIFICATION_KEY_REQUIRED',status:401}));
  await act(async()=>root.render(<App/>));
  expect(div.textContent).toContain('검증 제한 중');
  expect(div.querySelector('input[type=password]')).toBeNull();
});
test('OAuth guest gets fixed login link and no DEV key input',async()=>{
  api.mockResolvedValueOnce({provider:'mastodon'}).mockRejectedValueOnce(Object.assign(new Error('로그인 필요'),{status:401}));
  await act(async()=>root.render(<App/>));
  expect(div.querySelector('a').getAttribute('href')).toBe('/api/auth/mastodon/login');
  expect(div.querySelector('input[type=password]')).toBeNull();expect(setToken).not.toHaveBeenCalled();
});
test('OAuth USER without character restores cookie session, gets OAuth relink guidance and no admin menu',async()=>{
  api.mockResolvedValueOnce({provider:'mastodon'}).mockResolvedValueOnce({user:{id:'1',role:'USER',character_id:null}});
  await act(async()=>root.render(<App/>));
  expect(div.textContent).toContain('캐릭터 연결 확인');expect(div.textContent).not.toContain('관리자 영역');
  expect(setToken).not.toHaveBeenCalled();expect(api).toHaveBeenCalledTimes(2);
});
test('OAuth ADMIN without character can access existing protected admin UI',async()=>{
  api.mockResolvedValueOnce({provider:'mastodon'}).mockResolvedValueOnce({user:{id:'1',role:'ADMIN',character_id:null}});
  await act(async()=>root.render(<App/>));
  api.mockResolvedValueOnce({role:'ADMIN',authentication:'MASTODON'}).mockResolvedValueOnce({records:[]});
  await act(async()=>[...div.querySelectorAll('button')].find(b=>b.textContent==='관리자 영역').click());
  expect(div.textContent).toContain('인증 방식: MASTODON');expect(api).toHaveBeenCalledWith('/admin/access');
});
test('DEV mode retains key login and does not restore OAuth session',async()=>{
  api.mockResolvedValueOnce({provider:'dev'});await act(async()=>root.render(<App/>));
  expect(div.querySelector('input[type=password]')).not.toBeNull();expect(api).toHaveBeenCalledTimes(1);
});

test('direct admin URL stays gated for USER and pending authentication',async()=>{
 window.history.replaceState(null,'','/#admin/items?return=battle');let finish;
 api.mockImplementation(path=>path==='/auth/config'?Promise.resolve({provider:'mastodon'}):new Promise(r=>{finish=r;}));
 await act(async()=>root.render(<App/>));expect(div.querySelector('.admin-navigation')).toBeNull();
 await act(async()=>finish({user:{id:'1',role:'USER',character_id:null}}));expect(div.textContent).toContain('관리자 권한이 필요');expect(api).not.toHaveBeenCalledWith('/admin/items');
});
test('admin direct URL rechecks server access; logout removes content and back cannot restore access',async()=>{
 window.history.replaceState(null,'','/#admin/dashboard?return=cooking');
 api.mockImplementation(path=>Promise.resolve(path==='/auth/config'?{provider:'mastodon'}:path==='/auth/me'?{user:{id:'1',role:'ADMIN',character_id:null}}:path==='/admin/access'?{role:'ADMIN',authentication:'MASTODON'}:{loggedOut:true}));
 await act(async()=>root.render(<App/>));expect(div.querySelector('.admin-dashboard')).not.toBeNull();
 await act(async()=>div.querySelector('.admin-heading button:last-child').click());expect(div.querySelector('.admin-panel')).toBeNull();
 await act(async()=>{window.history.back();await new Promise(r=>setTimeout(r,30));});expect(div.querySelector('.admin-panel')).toBeNull();expect(div.querySelector('.admin-gate')).not.toBeNull();
});

test('public guide renders for guests without requesting game resources',async()=>{
 window.history.replaceState(null,'','/#game/world');api.mockImplementation(async path=>{if(path==='/public/guides/world')return {content:{title:'공개 제목',body:'운영진 내용'}};throw Object.assign(Error('검증 제한'),{code:'VERIFICATION_KEY_REQUIRED'});});await act(async()=>root.render(<App/>));expect(div.textContent).toContain('공개 제목');expect(api.mock.calls.some(([p])=>p.startsWith('/characters/'))).toBe(false);
});

test('existing blood gauge shows only configured RP name, no duplicate resource notice',async()=>{
 const character={id:'1',name:'러너',hp:100,blood:60,ap:10,max_hp:100,max_blood:100,max_ap:10,hunter_grade:'B',status:'ALIVE'};
 api.mockImplementation(async path=>{
 if(path==='/auth/config')return {provider:'mastodon'};
 if(path==='/auth/me')return {user:{id:'1',role:'USER',character_id:'1'}};
 if(path==='/characters/me')return {character};
 if(path==='/public/anemia')return {settings:{enabled:true,stages:[{name:'등록 단계',min:1,max:100,order:0}]}};
 throw new Error('테스트 대상 외 API');});
 await act(async()=>root.render(<App/>));
 const blood=[...div.querySelectorAll('.survival-resource')].find(e=>e.querySelector('b').textContent.startsWith('혈량'));
 expect(blood.querySelector('small').textContent).toBe(' · 등록 단계');expect(blood.querySelector('span').textContent).toBe('60 / 100');expect(blood.querySelector('progress').value).toBe(60);
 expect(div.querySelectorAll('[aria-label="빈혈 RP 단계"]')).toHaveLength(1);expect(div.textContent).not.toContain('운영진 확인 대기');expect(div.textContent).not.toContain('능력치 페널티는 없습니다');
});

test('linked pending character opens own page and explains missing configuration without approval',async()=>{
 const character={id:'44',name:'연결 러너',hp:100,blood:100,ap:10,max_hp:100,max_blood:100,max_ap:10,status:'ALIVE',initial_setup_complete:false};
 api.mockImplementation(async path=>{
  if(path==='/auth/config')return {provider:'mastodon'};
  if(path==='/auth/me')return {user:{id:'7',role:'USER',character_id:'44'}};
  if(path==='/characters/me')return {character};
  throw new Error('검증 제한');
 });
 await act(async()=>root.render(<App/>));
 expect(window.location.hash).toContain('character');
 expect(div.textContent).toContain('게임 초기 능력치가 아직 설정되지 않았습니다');
 expect(div.textContent).not.toContain('운영진 심사');
 expect(div.textContent).not.toContain('캐릭터 생성 준비');
});
