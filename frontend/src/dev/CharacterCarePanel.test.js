import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import CharacterCarePanel,{validCharacterId} from './CharacterCarePanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let box,root,refresh;const key='12345678-1234-4234-8234-123456789012';
const preview=(action='heal',id='2')=>({action,provider:{id:'1',blood:80},target:{id,name:'대상 생존자',hp:50},cost:action==='heal'?10:30,hpRecovery:20,expected:{providerBlood:action==='heal'?70:50,targetHp:action==='heal'?70:100,targetBlood:50,targetAp:7}});
const button=text=>[...box.querySelectorAll('button')].find(b=>b.textContent===text);
beforeEach(async()=>{global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=>key}});api.mockReset();refresh=jest.fn(async()=>true);box=document.createElement('div');document.body.append(box);root=createRoot(box);await act(async()=>root.render(<CharacterCarePanel character={{id:'1',status:'ALIVE'}} busy={false} run={f=>f()} refresh={refresh} notify={()=>{}}/>));});
afterEach(async()=>{await act(async()=>root.unmount());box.remove();});
async function open(action='heal'){await act(async()=>Simulate.change(box.querySelector('#care-target'),{target:{value:'2'}}));api.mockResolvedValueOnce(preview(action));await act(async()=>button(action==='heal'?'대상 치료':'대상 부활').click());}
test('invalid IDs remain blocked',()=>{for(const v of ['','0','-1','1.5','1e2','9223372036854775808'])expect(validCharacterId(v)).toBe(false);expect(validCharacterId('9223372036854775807')).toBe(true);});
test('preview shows server values; cancel never sends a POST',async()=>{await open();expect(box.textContent).toContain('대상 생존자');expect(box.textContent).toContain('혈량 소비: 10');expect(box.textContent).toContain('HP 회복: 20');expect(box.textContent).toContain('50 → 70');expect(api.mock.calls.every(([,o])=>o?.method!=='POST')).toBe(true);await act(async()=>button('취소').click());expect(box.querySelector('[aria-label="치료 부활 최종 확인"]')).toBeNull();expect(refresh).not.toHaveBeenCalled();});
test('confirmed actions send once, duplicate clicks blocked and committed result refreshed',async()=>{await open();let resolve;api.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await act(async()=>{button('실행 확인').click();button('실행 확인').click();});expect(api.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(1);api.mockResolvedValueOnce({logs:[]});await act(async()=>resolve({provider:{blood:70},target:{hp:70}}));expect(api).toHaveBeenCalledWith('/characters/2/heal',{method:'POST',body:{requestKey:key}});expect(refresh).toHaveBeenCalledTimes(1);expect(box.querySelector('[aria-label="치료 부활 최종 확인"]')).toBeNull();});
test('revive shows HP100 blood50 and preserved AP, server rejection refreshes state',async()=>{await open('revive');expect(box.textContent).toContain('혈량 소비: 30');expect(box.textContent).toContain('50 → 100');expect(box.textContent).toContain('혈량: 50');expect(box.textContent).toContain('AP: 7');api.mockRejectedValueOnce(Object.assign(Error('대상 상태가 변경됐습니다.'),{code:'TARGET_NOT_DEAD'}));await act(async()=>button('실행 확인').click());expect(box.textContent).toContain('TARGET_NOT_DEAD');expect(refresh).toHaveBeenCalledTimes(1);});
test('preview failure never invokes action; changed server costs are displayed',async()=>{api.mockRejectedValueOnce(Error('조회 실패'));await act(async()=>button('자기 치료').click());expect(box.textContent).toContain('조회 실패');api.mockResolvedValueOnce({...preview('heal','1'),cost:13});await act(async()=>button('자기 치료').click());expect(box.textContent).toContain('혈량 소비: 13');expect(api.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(0);});
test('log lookup failure preserves committed care; later rejected action clears old success',async()=>{
 await open();api.mockResolvedValueOnce({provider:{blood:70},target:{hp:70}}).mockRejectedValueOnce(Error('로그 조회 실패'));
 await act(async()=>button('실행 확인').click());expect(box.textContent).toContain('치료 성공');expect(box.textContent).toContain('변경 전 로그 조회 실패');
 await open();api.mockRejectedValueOnce(Object.assign(Error('혈량 부족'),{code:'NOT_ENOUGH_BLOOD'}));await act(async()=>button('실행 확인').click());
 expect(box.querySelector('[aria-label="치료 부활 결과"]')).toBeNull();expect(box.textContent).toContain('NOT_ENOUGH_BLOOD');expect(refresh).toHaveBeenCalledTimes(2);
});
