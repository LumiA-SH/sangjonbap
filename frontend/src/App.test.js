import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {api,setToken} from './api/client';
jest.mock('./api/client',()=>({api:jest.fn(),setToken:jest.fn()}));
let root,div;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;api.mockReset();setToken.mockReset();div=document.createElement('div');root=createRoot(div);});
afterEach(async()=>{await act(async()=>root.unmount());});
test('OAuth guest gets fixed login link and no DEV key input',async()=>{
  api.mockResolvedValueOnce({provider:'mastodon'}).mockRejectedValueOnce(Object.assign(new Error('로그인 필요'),{status:401}));
  await act(async()=>root.render(<App/>));
  expect(div.querySelector('a').getAttribute('href')).toBe('/api/auth/mastodon/login');
  expect(div.querySelector('input[type=password]')).toBeNull();expect(setToken).not.toHaveBeenCalled();
});
test('OAuth USER without character restores cookie session, gets creation HOLD and no admin menu',async()=>{
  api.mockResolvedValueOnce({provider:'mastodon'}).mockResolvedValueOnce({user:{id:'1',role:'USER',character_id:null}});
  await act(async()=>root.render(<App/>));
  expect(div.textContent).toContain('캐릭터 생성 준비');expect(div.textContent).not.toContain('관리자 영역');
  expect(setToken).not.toHaveBeenCalled();expect(api).toHaveBeenCalledTimes(2);
});
test('OAuth ADMIN without character can access existing protected admin UI',async()=>{
  api.mockResolvedValueOnce({provider:'mastodon'}).mockResolvedValueOnce({user:{id:'1',role:'ADMIN',character_id:null}});
  await act(async()=>root.render(<App/>));
  api.mockResolvedValueOnce({authentication:'MASTODON'}).mockResolvedValueOnce({records:[]});
  await act(async()=>[...div.querySelectorAll('button')].find(b=>b.textContent==='관리자 영역').click());
  expect(div.textContent).toContain('인증 방식: MASTODON');expect(api).toHaveBeenCalledWith('/admin/access');
});
test('DEV mode retains key login and does not restore OAuth session',async()=>{
  api.mockResolvedValueOnce({provider:'dev'});await act(async()=>root.render(<App/>));
  expect(div.querySelector('input[type=password]')).not.toBeNull();expect(api).toHaveBeenCalledTimes(1);
});
