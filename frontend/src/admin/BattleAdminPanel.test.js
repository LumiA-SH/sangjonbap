import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import BattleAdminPanel from './BattleAdminPanel';
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
const setup=()=>api.mockImplementation(async path=>path==='/admin/battle-abilities'?{settings:{battle_ability_b_multiplier:1.8,battle_ability_b_ap_cost:2}}:{records:[]});
test('loads admin lists and ability settings; rejects invalid probability before saving',async()=>{
  setup();await act(async()=>root.render(<BattleAdminPanel onDenied={()=>{}}/>));
  expect(api).toHaveBeenCalledWith('/admin/monsters');expect(container.textContent).toContain('활성 확률 합계: 100%');
  const label=[...container.querySelectorAll('label')].find(l=>l.textContent==='확률 %');
  await act(async()=>Simulate.change(label.querySelector('input'),{target:{value:'99'}}));
  await act(async()=>Simulate.submit(container.querySelector('form')));
  expect(container.textContent).toContain('활성 행동 확률 합계는 100%');
  expect(api.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(0);
});
test('monster save sends UUID, locks duplicate clicks and reloads detail',async()=>{
  setup();await act(async()=>root.render(<BattleAdminPanel onDenied={()=>{}}/>));
  let finish;const pending=new Promise(r=>{finish=r;});
  const record={id:'5',name:'마물',max_hp:1,atk:0,def:0,agi:0,is_active:false,areas:[],drops:[],actions:[{name:'공격',action_type:'ATTACK',probability:100,multiplier:1,is_active:true,sort_order:0}]};
  api.mockImplementation(async(path,options)=>options?.method==='POST'?pending:path==='/admin/monsters/5'?{record}:path==='/admin/battle-abilities'?{settings:{}}:{records:[]});
  await act(async()=>{Simulate.submit(container.querySelector('form'));Simulate.submit(container.querySelector('form'));});
  expect(api.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1);
  expect(button('마물 저장').disabled).toBe(true);
  expect(api).toHaveBeenCalledWith('/admin/monsters',expect.objectContaining({body:expect.objectContaining({requestKey:'12345678-1234-4234-8234-123456789012'})}));
  await act(async()=>finish({record}));expect(api).toHaveBeenCalledWith('/admin/monsters/5');expect(container.textContent).toContain('마물 저장 성공');
});
test('permission errors reach the existing admin gate',async()=>{
  const denied=jest.fn();api.mockRejectedValue(Object.assign(Error('관리자 필요'),{status:403,code:'ADMIN_REQUIRED'}));
  await act(async()=>root.render(<BattleAdminPanel onDenied={denied}/>));
  expect(denied).toHaveBeenCalledWith('관리자 필요');expect(container.textContent).toContain('ADMIN_REQUIRED');
});
