import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import MasterPanel,{validateDraft} from './MasterPanel';
import RolePanel from './RolePanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let root,container;
const uuid='12345678-1234-4234-8234-123456789012';
const button=text=>[...container.querySelectorAll('button')].find(b=>b.textContent===text);
const input=label=>[...container.querySelectorAll('label')].find(l=>l.textContent.startsWith(label)&&!l.textContent.includes('이름 검색')).querySelector('input,select,textarea');
async function change(label,value){await act(async()=>Simulate.change(input(label),{target:{value}}));}
beforeEach(()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;
  Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=>uuid}});
  api.mockReset();container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();jest.restoreAllMocks();});
async function mount(kind,onDenied=jest.fn()) {
  api.mockResolvedValueOnce({records:[],nextAfter:null});
  await act(async()=>root.render(<MasterPanel kind={kind} onDenied={onDenied}/>));
}

test('area creation is available; encounter edit sends only changed fields to preserve concurrent progress',async()=>{
  api.mockResolvedValueOnce({records:[{id:'2',name:'지역',encounter_rate:0}],nextAfter:null});
  await act(async()=>root.render(<MasterPanel kind="areas" onDenied={jest.fn()}/>));
  expect(button('새로 등록')).toBeTruthy();expect(container.querySelector('form')).toBeTruthy();
  api.mockResolvedValueOnce({record:{id:'2',name:'지역',encounter_rate:0,is_open:true,unlock_at:'2026-11-03T00:00:00+09:00'}});
  await act(async()=>button('상세/수정').click());await change('조우 확률','40');
  api.mockResolvedValueOnce({record:{id:'2',encounter_rate:40}}).mockResolvedValueOnce({records:[],nextAfter:null});
  await act(async()=>Simulate.submit(container.querySelector('form')));
  expect(api).toHaveBeenCalledWith('/admin/areas/2',{method:'PATCH',body:{encounter_rate:40,requestKey:uuid}});
});
test('food client validation, save UUID, reload and DB detail',async()=>{
  await mount('foods');
  await act(async()=>Simulate.submit(container.querySelector('form')));
  expect(container.textContent).toContain('양의 정수');expect(api).toHaveBeenCalledTimes(1);
  await change('아이템 ID','42');await change('혈량 회복','7');
  api.mockResolvedValueOnce({record:{id:'42',item_id:'42',blood_recovery:7}}).mockResolvedValueOnce({records:[{id:'42',item_id:'42'}],nextAfter:null});
  await act(async()=>Simulate.submit(container.querySelector('form')));
  expect(api).toHaveBeenCalledWith('/admin/foods',expect.objectContaining({body:expect.objectContaining({item_id:'42',blood_recovery:7,requestKey:uuid})}));
  expect(container.textContent).toContain('저장 성공');
  expect(input('아이템 ID').disabled).toBe(true);
});
test('recipe multi-row add/remove and nested body; prevents duplicate submit',async()=>{
  await mount('recipes');await change('이름','DEV recipe');await change('성공 음식 ID','5');await change('실패 음식 ID','8');
  await act(async()=>button('행 추가').click());await change('재료 ID','6');
  await act(async()=>button('행 추가').click());expect(container.querySelectorAll('.admin-child-row')).toHaveLength(2);
  await act(async()=>[...container.querySelectorAll('button')].filter(b=>b.textContent==='행 제거')[1].click());
  let resolve;api.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  await act(async()=>{Simulate.submit(container.querySelector('form'));Simulate.submit(container.querySelector('form'));});
  expect(api.mock.calls.filter(([url,opts])=>url==='/admin/recipes'&&opts?.method==='POST')).toHaveLength(1);
  expect(api).toHaveBeenCalledWith('/admin/recipes',expect.objectContaining({body:expect.objectContaining({ingredients:[{item_id:'6',quantity:1}],requestKey:uuid})}));
  api.mockResolvedValueOnce({records:[],nextAfter:null});
  await act(async()=>resolve({record:{id:'7',name:'DEV recipe',success_rate:100,result_item_id:'5',ingredients:[{item_id:'6',quantity:1}]}}));
  expect(container.textContent).toContain('저장 성공');
});
test('gacha stock probability and payload exclude legacy weights and calculated fields',async()=>{
  api.mockResolvedValueOnce({records:[{id:'3',name:'DEV gacha'}],nextAfter:null});
  await act(async()=>root.render(<MasterPanel kind="gachas" onDenied={jest.fn()}/>));
  api.mockResolvedValueOnce({record:{id:'3',name:'DEV gacha',price:1,is_active:true,start_at:null,end_at:null,rewards:[{id:'1',item_id:'5',quantity:1,max_stock:1,remaining_stock:1,probability:25},{id:'2',item_id:'6',quantity:1,max_stock:3,remaining_stock:3,probability:75}]}});
  await act(async()=>button('상세/수정').click());
  expect(container.textContent).toContain('25.0000%');expect(container.textContent).toContain('75.0000%');
  api.mockRejectedValueOnce(Object.assign(new Error('설정 오류'),{status:400,code:'INVALID_ADMIN_INPUT'}));
  await act(async()=>Simulate.submit(container.querySelector('form')));
  expect(api).toHaveBeenCalledWith('/admin/gachas/3',expect.objectContaining({method:'PATCH',body:expect.objectContaining({rewards:[{item_id:'5',quantity:1,max_stock:1,remaining_stock:1,is_active:true},{item_id:'6',quantity:1,max_stock:3,remaining_stock:3,is_active:true}]})}));
  expect(container.textContent).toContain('INVALID_ADMIN_INPUT');expect(container.textContent).not.toContain('저장 성공');
});
test('permission loss propagates; growth, ingredient, date precision validation',async()=>{
  const denied=jest.fn();await mount('foods',denied);await change('아이템 ID','42');
  api.mockRejectedValueOnce(Object.assign(new Error('권한 회수'),{status:403,code:'ADMIN_REQUIRED'}));
  await act(async()=>Simulate.submit(container.querySelector('form')));expect(denied).toHaveBeenCalledWith('권한 회수');
  expect(validateDraft('foods',{item_id:'1',stat_growth_enabled:false,stat_growth_target:'ATK',stat_growth_value:1})).toContain('비활성');
  expect(validateDraft('recipes',{name:'a',result_item_id:'1',success_rate:100,ingredients:[{item_id:'2',quantity:1},{item_id:'2',quantity:1}]})).toContain('중복');
  expect(validateDraft('gachas',{name:'g',price:1,start_at:'2026-10-11T00:00:00.000001Z',end_at:'2026-10-11T00:00:00.000002Z',rewards:[{item_id:'2',quantity:1,weight:1}]})).toBe('');
});

test('area visibility editing sends scheduled ISO time and leaves investigation progress untouched',async()=>{
  api.mockResolvedValueOnce({records:[{id:'1',name:'지역'}],nextAfter:null});
  await act(async()=>root.render(<MasterPanel kind="areas" onDenied={jest.fn()}/>));
  api.mockResolvedValueOnce({record:{id:'1',name:'지역',encounter_rate:40,is_open:false,unlock_at:null,investigation_rate:75}});
  await act(async()=>button('상세/수정').click());
  await act(async()=>Simulate.change(container.querySelector('input[type="checkbox"]'),{target:{checked:true}}));
  await change('공개 시각 (시간대 포함 ISO, 비우면 즉시)','2026-11-03T00:00:00+09:00');
  api.mockResolvedValueOnce({record:{id:'1',encounter_rate:40,is_open:true,unlock_at:'2026-11-03T00:00:00+09:00'}})
    .mockResolvedValueOnce({records:[],nextAfter:null});
  await act(async()=>Simulate.submit(container.querySelector('form')));
  expect(api).toHaveBeenCalledWith('/admin/areas/1',{method:'PATCH',body:{is_open:true,unlock_at:'2026-11-03T00:00:00+09:00',requestKey:uuid}});
  expect(validateDraft('areas',{unlock_at:'2026-11-03T00:00:00'})).toContain('시각');
  expect(validateDraft('recipes',{ingredients:Array.from({length:6},(_,i)=>({item_id:String(i+1),quantity:1}))})).toContain('최대 5종');
});
test('role search distinguishes account IDs, confirms change and reloads, cancellation sends nothing',async()=>{
  const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);
  await act(async()=>root.render(<RolePanel onDenied={jest.fn()}/>));
  await change('캐릭터 이름 또는 계정 ID','동명이인');
  api.mockResolvedValueOnce({records:[{id:'2',character_name:'동명이인',role:'USER',is_active:true},{id:'3',character_name:'동명이인',role:'ADMIN',is_active:true}],nextAfter:null});
  await act(async()=>Simulate.submit(container.querySelector('form')));
  expect(container.textContent).toContain('계정 ID 2');expect(container.textContent).toContain('계정 ID 3');
  await act(async()=>button('관리자 지정').click());expect(api).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);
  api.mockResolvedValueOnce({record:{id:'2',role:'ADMIN'}}).mockResolvedValueOnce({records:[],nextAfter:null});
  await act(async()=>button('관리자 지정').click());
  expect(api).toHaveBeenCalledWith('/admin/users/2/role',{method:'PATCH',body:{role:'ADMIN',requestKey:uuid}});
  expect(container.textContent).toContain('권한 변경');
});
