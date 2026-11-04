import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import RecordsPanel from './RecordsPanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let root,container;
const button=text=>[...container.querySelectorAll('button')].find(b=>b.textContent===text);
beforeEach(()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;api.mockReset();
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});

test('own logs paginate; archive sections use read-only endpoints and display only server results',async()=>{
  api.mockResolvedValueOnce({records:[{id:'31',action_type:'HEAL',detail:{cost:10}}],nextBefore:'2'});
  await act(async()=>root.render(<RecordsPanel/>));
  expect(api).toHaveBeenLastCalledWith('/records/action-logs');
  expect(container.textContent).toContain('HEAL');expect(container.querySelector('details')).not.toBeNull();
  api.mockResolvedValueOnce({records:[],nextBefore:null});
  await act(async()=>button('이전 기록 30건').click());
  expect(api).toHaveBeenLastCalledWith('/records/action-logs?before=2');
  api.mockResolvedValueOnce({records:[{id:'4',title:'공개 단서',content:'안전한 텍스트 <script>',area_name:'폐허'}],nextBefore:null});
  await act(async()=>button('공개된 단서').click());
  expect(api).toHaveBeenLastCalledWith('/records/clues');
  expect(container.textContent).toContain('공개 단서');expect(container.querySelector('script')).toBeNull();
});

test('admin log access loss clears displayed records and reports permission error',async()=>{
  const denied=jest.fn();
  api.mockResolvedValueOnce({records:[{id:'9',description:'관리 기록'}],nextBefore:null});
  await act(async()=>root.render(<RecordsPanel admin onDenied={denied}/>));
  expect(api).toHaveBeenLastCalledWith('/admin/action-logs');
  api.mockRejectedValueOnce(Object.assign(new Error('권한 없음'),{status:403,code:'ADMIN_REQUIRED'}));
  await act(async()=>button('기록 새로고침').click());
  expect(container.textContent).not.toContain('관리 기록');expect(container.textContent).toContain('ADMIN_REQUIRED');
  expect(denied).toHaveBeenCalledWith('권한 없음');
});
