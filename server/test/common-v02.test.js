import test from 'node:test';
import assert from 'node:assert/strict';
import {changeCharacterResources} from '../src/shared/game.js';
import {requireActionCharacter,requireNoActiveBattle} from '../src/shared/actions.js';
import {validateInitialStats} from '../src/modules/character/initial-stats.js';

test('v0.2 blood cap clamps recovery without rewriting max or converting legacy blood',async()=>{
    const before={id:'1',hp:50,max_hp:100,blood:95,max_blood:200,ap:1,max_ap:10,currency:0,status:'ALIVE',death_count:0};
    let values;
    const client={async query(sql,p){values=p;return {rows:[{...before,hp:p[0],blood:p[1],ap:p[2]}]};}};
    assert.equal((await changeCharacterResources(client,before,{blood:30})).blood,100);
    assert.equal(before.max_blood,200);
    assert.equal((await changeCharacterResources(client,{...before,max_blood:80,blood:70},{blood:30})).blood,80);
    const previous=values;
    await assert.rejects(changeCharacterResources(client,{...before,blood:150},{blood:-10}),{code:'LEGACY_BLOOD_HOLD'});
    assert.equal(values,previous);
    assert.equal((await changeCharacterResources(client,{...before,blood:150},{ap:1})).blood,150);
});

test('v0.2 living/near/dead matrix and active battle server guard',async()=>{
    const alive={id:'1',hp:100,blood:10,status:'ALIVE'};
    requireActionCharacter(alive);
    for(const allowNearDeath of [false,true]) {
        assert.throws(()=>requireActionCharacter({...alive,status:'DEAD'},{allowNearDeath}),{code:'CHARACTER_DEAD'});
    }
    assert.throws(()=>requireActionCharacter({...alive,blood:0,status:'NEAR_DEATH'}),{code:'CHARACTER_NEAR_DEATH'});
    requireActionCharacter({...alive,blood:0,status:'NEAR_DEATH'},{allowNearDeath:true});
    await assert.rejects(requireNoActiveBattle({async query(sql,p){assert.match(sql,/for share/);assert.deepEqual(p,['1']);return {rowCount:1};}},alive),{code:'BATTLE_ACTIVE'});
    await requireNoActiveBattle({async query(){return {rowCount:0};}},alive);
});

test('v0.2 initial ranges and sums preserve grade-specific validation',()=>{
    for(const [grade,stats] of [['B',{atk:8,def:8,agi:20}],['A',{atk:8,def:8,agi:24}],['S',{atk:15,def:15,agi:15}]]) {
        assert.deepEqual(validateInitialStats(grade,stats),stats);
    }
    for(const stats of [{atk:16,def:15,agi:15},{atk:7,def:18,agi:20},{atk:41,def:2,agi:2}]) {
        assert.throws(()=>validateInitialStats('S',stats),{code:'INVALID_INITIAL_STATS'});
    }
});
