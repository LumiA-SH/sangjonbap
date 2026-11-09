import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import CoinTransferPanel from './CoinTransferPanel';
import PublicCharacterPanel from './PublicCharacterPanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let box,root,refresh;const button=text=>[...box.querySelectorAll('button')].find(b=>b.textContent===text);
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});api.mockReset();refresh=jest.fn(async()=>true);box=document.createElement('div');document.body.append(box);root=createRoot(box);});
afterEach(async()=>{await act(async()=>root.unmount());box.remove();});
async function search(){await act(async()=>Simulate.change(box.querySelector('input'),{target:{value:'대상'}}));api.mockResolvedValueOnce({characters:[{id:'2',name:'대상'}]});await act(async()=>Simulate.submit(box.querySelector('form')));}
test('coin confirmation cancel, anemic sender, same-key network retry and double click',async()=>{
 await act(async()=>root.render(<CoinTransferPanel character={{id:'1',status:'NEAR_DEATH',currency:10}} refresh={refresh}/>));await search();await act(async()=>button('ID 2 선택').click());
 await act(async()=>button('코인 양도 확인').click());await act(async()=>button('취소').click());expect(api.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(0);
 await act(async()=>button('코인 양도 확인').click());api.mockRejectedValueOnce(Error('응답 유실'));await act(async()=>button('코인 양도 확정').click());
 let resolve;api.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await act(async()=>{button('코인 양도 확정').click();button('코인 양도 확정').click();});
 const calls=api.mock.calls.filter(([,o])=>o?.method==='POST');expect(calls).toHaveLength(2);expect(calls[0]).toEqual(calls[1]);await act(async()=>resolve({currency:9}));expect(box.textContent).toContain('양도 완료');
});
test('coin invalid amounts, dead and battle senders cannot submit',async()=>{
 const render=character=>act(async()=>root.render(<CoinTransferPanel character={character} refresh={refresh}/>));await render({id:'1',status:'ALIVE',currency:10});await search();await act(async()=>button('ID 2 선택').click());
 for(const value of ['0','-1','1.5','11']){await act(async()=>Simulate.change(box.querySelector('#coin-quantity'),{target:{value}}));expect(button('코인 양도 확인').disabled).toBe(true);}
 await act(async()=>Simulate.change(box.querySelector('#coin-quantity'),{target:{value:'1'}}));await render({id:'1',status:'DEAD',currency:10});expect(button('코인 양도 확인').disabled).toBe(true);await render({id:'1',status:'ALIVE',currency:10,in_active_battle:true});expect(button('코인 양도 확인').disabled).toBe(true);
});
test('public details render dead character and inventory without edit controls',async()=>{
 await act(async()=>root.render(<PublicCharacterPanel/>));await search();api.mockResolvedValueOnce({character:{id:'2',name:'대상',status:'DEAD',hp:0,max_hp:100,blood:0,max_blood:100,ap:7,max_ap:10,atk:10,def:11,agi:12},inventory:[{itemId:'3',name:'혈액팩',quantity:2}]});await act(async()=>button('ID 2 선택').click());expect(box.textContent).toContain('DEAD');expect(box.textContent).toContain('혈액팩 × 2');expect(box.querySelectorAll('dd')).toHaveLength(6);expect(api.mock.calls.every(([,o])=>!o?.method)).toBe(true);expect(box.textContent).toContain('수정할 수 없습니다');
});
