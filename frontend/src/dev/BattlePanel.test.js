import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import BattlePanel from './BattlePanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let root,container;
const state=(status='ACTIVE',options=['ATTACK','DEFEND','ABILITY','ITEM','FLEE'])=>({battle:{id:'4',battle_status:status,turn_no:2,monster:{name:'테스트 마물'},monster_hp:20,monster_max_hp:50,declaration:{name:'공격 예고',action_type:'ATTACK'},options:status==='ACTIVE'?options:[]},character:{hp:70,max_hp:100,blood:20,max_blood:100,ap:5,max_ap:10},logs:[{id:'1',turn_no:1,actor_type:'PC',action_type:'ATTACK',message:'이전 공격'}],rewards:[],currencyReward:0});
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;api.mockReset();Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const button=text=>[...container.querySelectorAll('button')].find(b=>b.textContent===text);
async function render(){await act(async()=>root.render(<BattlePanel busy={false} run={f=>f()} refresh={async()=>{}}/>));}
test('restores latest battle, resources and server-provided five commands',async()=>{
    api.mockResolvedValue(state());await render();expect(api).toHaveBeenCalledWith('/battles/latest');
    for(const name of ['일반공격','방어','이능공격','아이템 사용','도주'])expect(button(name)).toBeTruthy();
    expect(button('도주차단')).toBeUndefined();expect(container.textContent).toContain('이전 공격');expect(container.textContent).toContain('70/100');
});
test('monster flee offers block flee instead of defend',async()=>{
    api.mockResolvedValue(state('ACTIVE',['ATTACK','ABILITY','ITEM','FLEE','BLOCK_FLEE']));await render();
    expect(button('도주차단')).toBeTruthy();expect(button('방어')).toBeUndefined();
});
test('one pending command carries UUID and turn, then displays persisted victory',async()=>{
    let finish;const ended={...state('VICTORY'),currencyReward:2,rewards:[{itemId:'9',name:'식재료',quantity:1,guaranteed:true}]};
    api.mockResolvedValueOnce(state()).mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValue(ended);
    await render();await act(async()=>{button('일반공격').click();button('일반공격').click();});
    expect(api.mock.calls.filter(([url])=>url.endsWith('/commands'))).toHaveLength(1);
    expect(api).toHaveBeenCalledWith('/battles/4/commands',{method:'POST',body:{requestKey:'12345678-1234-4234-8234-123456789012',turnNo:2,action:'ATTACK'}});
    await act(async()=>finish(ended));expect(button('일반공격')).toBeUndefined();expect(container.textContent).toContain('지급 재화: 2');expect(container.textContent).toContain('식재료 보장');
});
test('timeout and stale-turn errors refresh without granting rewards locally',async()=>{
    api.mockResolvedValueOnce(state()).mockRejectedValueOnce(Object.assign(new Error('이미 처리된 턴'),{code:'STALE_BATTLE_TURN'})).mockResolvedValue({...state('DEFEAT'),battle:{...state('DEFEAT').battle,end_reason:'TIMEOUT'}});
    await render();await act(async()=>button('일반공격').click());
    expect(container.textContent).toContain('STALE_BATTLE_TURN');expect(container.textContent).toContain('TIMEOUT');expect(container.textContent).toContain('지급 재화: 0');expect(button('일반공격')).toBeUndefined();
});

test('image failure fallback, ability ownership and exact AP snapshot cost',async()=>{
 const data=state();data.battle.monster.image_url='https://example.invalid/monster.png';data.character.has_ability=false;api.mockResolvedValue(data);await render();
 expect(button('이능공격').disabled).toBe(true);expect(container.textContent).toContain('이능을 보유하지 않았습니다');
 await act(async()=>container.querySelector('img').dispatchEvent(new Event('error')));expect(container.querySelector('img')).toBeNull();expect(container.textContent).toContain('마물 이미지가 없습니다');
 data.character.has_ability=true;data.character.ability_grade='B';data.character.ap=1;data.battle.abilityApCosts={B:2};await act(async()=>button('전투 새로고침').click());expect(container.textContent).toContain('AP 부족: 필요 2, 현재 1');expect(button('이능공격').disabled).toBe(true);
 data.character.ap=2;await act(async()=>button('전투 새로고침').click());expect(button('이능공격').disabled).toBe(false);
});
test('mutual kill shows victory and historical PC death even after revival',async()=>{
 const data=state('VICTORY');data.battle.character_hp=0;data.character.status='ALIVE';api.mockResolvedValue(data);await render();expect(container.textContent).toContain('전투는 승리했지만 PC는 사망했습니다');expect(container.textContent).toContain('현재 캐릭터 상태: 생존');expect(button('일반공격')).toBeUndefined();
});
test('near-death state disables all battle commands with reason',async()=>{
 const data=state();data.character.blood=0;data.character.status='NEAR_DEATH';api.mockResolvedValue(data);await render();expect(button('일반공격').disabled).toBe(true);expect(container.textContent).toContain('혈량 0의 빈사 상태');
});
