import {dailyGateFixture} from './daily-gate-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createGachaRepository} from '../src/modules/gacha/repository.js';
import {requireRpItem,validateStockChange} from '../src/modules/gacha/rules.js';
import {saveGachaStock} from '../src/modules/admin/gacha-stock.js';

const rp={id:'8',name:'RP 물품',description:'추억을 적는 물품',is_active:true,transferable:true,usable:false,battle_usable:false,effect_type:null,effect_value:null,use_target:'NONE',category:'ETC'};
// SQL transaction emulator: verifies write ordering and rollback, NOT PostgreSQL row locking.
function fixture({stock=1,currency=2,failLog=false,item=rp,food=false}={}) {
    let state={character:{id:'1',hp:100,max_hp:100,blood:100,max_blood:100,ap:10,max_ap:10,currency,status:'ALIVE',death_count:0},stock,inventory:0,logs:[]};
    let snapshot;const calls=[];const rows=values=>({rows:values,rowCount:values.length});
    const client={release(){},async query(raw,p=[]) {const dailyGateResult=dailyGateFixture(raw);if(dailyGateResult)return dailyGateResult;
        const sql=raw.replace(/\s+/g,' ').trim();calls.push(sql);
        if(sql==='begin'){snapshot=structuredClone(state);return rows([]);}
        if(sql==='commit')return rows([]);if(sql==='rollback'){state=snapshot;return rows([]);}
        if(sql.startsWith('select id from public.action_log'))return rows(state.logs.filter(l=>l.key===p[0]));
        if(sql.startsWith('select c.*'))return rows([{...state.character}]);
        if(sql.startsWith('select id from public.battle'))return rows([]);
        if(sql.startsWith('select * from public.gacha where'))return rows([{id:'4',name:'RP 가챠',is_active:true,price:99}]);
        if(sql.startsWith('select * from public.gacha_reward'))return rows([{id:'7',item_id:'8',quantity:99,weight:99,max_stock:stock==null?null:Math.max(1,stock),remaining_stock:state.stock}]);
        if(sql.startsWith('select * from public.item'))return rows([item]);
        if(sql.startsWith('select 1 from public.food_config'))return rows(food?[{}]:[]);
        if(sql.includes('cross join (select clock_timestamp() as now)'))return rows([{boundary:false,outside:false}]);
        if(sql.startsWith('select quantity from public.inventory'))return rows([{quantity:state.inventory}]);
        if(sql.startsWith('update public.gacha_reward')){if(!state.stock)return rows([]);state.stock--;return rows([{remaining_stock:state.stock}]);}
        if(sql.startsWith('update public.game_character')){['hp','blood','ap','currency','status','death_count'].forEach((k,i)=>state.character[k]=p[i]);return rows([{...state.character}]);}
        if(sql.startsWith('select id,quantity from public.inventory'))return rows(state.inventory?[{id:'1',quantity:state.inventory}]:[]);
        if(sql.startsWith('insert into public.inventory')){state.inventory=p[2];return rows([]);}
        if(sql.startsWith('update public.inventory')){state.inventory=p[0];return rows([]);}
        if(sql.startsWith('insert into public.action_log')){if(failLog)throw Error('injected audit failure');state.logs.push({key:p[8],detail:JSON.parse(p[7])});return rows([]);}
        throw Error(`Unexpected SQL ${sql}`);
    }};
    return {repo:createGachaRepository({connect:async()=>client},{random:()=>0}),state:()=>state,calls};
}
test('one stock draw charges one, grants one RP item with description, persists log and no stock leakage',async()=>{
    const f=fixture(),result=await f.repo.drawGacha('u','4',randomUUID());
    assert.equal(f.state().stock,0);assert.equal(f.state().character.currency,1);assert.equal(f.state().inventory,1);
    assert.equal(result.reward.quantity,1);assert.equal(result.reward.description,rp.description);assert.equal(result.price,1);
    assert.equal(JSON.stringify(result).includes('remaining_stock'),false);assert.equal(JSON.stringify(result).includes('weight'),false);
    assert.equal(f.state().logs.length,1);
    assert(f.calls.some(sql=>sql==='select * from public.gacha where id=$1 for update'));
    assert(f.calls.some(sql=>sql.includes('gacha_reward')&&sql.endsWith('for update')));
});
test('sold out, missing stock, insufficient coin, non-RP items never debit or grant',async()=>{
    for(const [options,code] of [[{stock:0},'GACHA_SOLD_OUT'],[{stock:null},'GACHA_STOCK_HOLD'],[{currency:0},'NOT_ENOUGH_CURRENCY'],[{item:{...rp,usable:true}},'GACHA_RP_ITEM_REQUIRED'],[{food:true},'GACHA_RP_ITEM_REQUIRED']]){
        const f=fixture(options),before=structuredClone(f.state());
        await assert.rejects(f.repo.drawGacha('u','4',randomUUID()),e=>e.code===code);assert.deepEqual(f.state(),before);
        assert.equal(f.calls.some(sql=>sql.startsWith('update public.gacha_reward')),false);
    }
});
test('duplicate request rejects without a second inventory grant or stock debit',async()=>{
    const f=fixture({stock:2}),key=randomUUID();await f.repo.drawGacha('u','4',key);const before=structuredClone(f.state());
    await assert.rejects(f.repo.drawGacha('u','4',key),e=>e.code==='DUPLICATE_REQUEST');assert.deepEqual(f.state(),before);
});
test('audit failure rolls back stock, coins and inventory together',async()=>{
    const f=fixture({failLog:true}),before=structuredClone(f.state());
    await assert.rejects(f.repo.drawGacha('u','4',randomUUID()),/injected/);assert.deepEqual(f.state(),before);assert.equal(f.calls.at(-1),'rollback');
});
test('RP requirement rejects all usable/combat/nontransferable/food variants without changing normal items',()=>{
    assert.doesNotThrow(()=>requireRpItem(rp));
    for(const patch of [{is_active:false},{usable:true},{battle_usable:true},{transferable:false},{effect_type:'BLOOD_PACK'},{effect_value:10},{use_target:'SELF'},{category:'FOOD'}])assert.throws(()=>requireRpItem({...rp,...patch}),e=>e.code==='GACHA_RP_ITEM_REQUIRED');
});
test('stock edit preserves already awarded count and rejects stale administrator draft',()=>{
    const before={max_stock:4,remaining_stock:2};
    for(const next of [{max_stock:5,remaining_stock:3},{max_stock:2,remaining_stock:0}])assert.doesNotThrow(()=>validateStockChange(before,next));
    for(const next of [{max_stock:5,remaining_stock:5},{max_stock:1,remaining_stock:0},{max_stock:4,remaining_stock:3},{max_stock:0,remaining_stock:0},{max_stock:4,remaining_stock:-1}])assert.throws(()=>validateStockChange(before,next));
    assert.throws(()=>validateStockChange(null,{max_stock:3,remaining_stock:1}));
});
test('admin stock update preserves reward IDs; legacy history blocks inferred stock',async()=>{
    const calls=[];let historical=false;
    const c={async query(sql,p){const dailyGateResult=dailyGateFixture(sql);if(dailyGateResult)return dailyGateResult;calls.push({sql,p});if(sql.includes('public.action_log'))return {rowCount:historical?1:0,rows:[]};if(sql.startsWith('select * from public.item'))return {rows:[rp]};return {rows:[],rowCount:0};}};
    await saveGachaStock(c,'4',{rewards:[{id:'7',item_id:'8',max_stock:4,remaining_stock:2}]},[{item_id:'8',max_stock:5,remaining_stock:3}]);
    assert(calls.some(c=>c.sql.includes('on conflict(gacha_id,item_id) do update')));assert(!calls.some(c=>c.sql.startsWith('delete')));
    historical=true;
    await assert.rejects(saveGachaStock(c,'4',{rewards:[{id:'7',item_id:'8',max_stock:null,remaining_stock:null}]},[{item_id:'8',max_stock:3,remaining_stock:3}]),e=>e.code==='GACHA_STOCK_MIGRATION_HOLD');
});
test('inactive new reward still requires RP item; legacy inactive record can remain unresolved',async()=>{
    const calls=[];
    const c={async query(sql,p){const dailyGateResult=dailyGateFixture(sql);if(dailyGateResult)return dailyGateResult;calls.push(sql);return sql.startsWith('select * from public.item')?{rows:[{...rp,usable:true}]}:{rows:[],rowCount:0};}};
    await assert.rejects(saveGachaStock(c,'4',null,[{item_id:'8',max_stock:1,remaining_stock:1,is_active:false}]),e=>e.code==='GACHA_RP_ITEM_REQUIRED');
    assert.equal(calls.some(sql=>sql.startsWith('insert')),false);
    await saveGachaStock(c,'4',{rewards:[{id:'7',item_id:'8',max_stock:null,remaining_stock:null}]},[{item_id:'8',max_stock:null,remaining_stock:null,is_active:false}]);
    assert(calls.some(sql=>sql.startsWith('update public.gacha_reward set is_active=false')));
    await assert.rejects(saveGachaStock(c,'4',{rewards:[{id:'7',item_id:'8',max_stock:3,remaining_stock:2}]},[{item_id:'8',max_stock:null,remaining_stock:null,is_active:false}]),e=>e.code==='GACHA_STOCK_CONFLICT');
});
