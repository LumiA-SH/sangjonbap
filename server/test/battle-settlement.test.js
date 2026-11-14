import {dailyGateFixture} from './daily-gate-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createBattleRepository} from '../src/modules/battle/repository.js';

function fixture({failLog = false, expired = false, monsterHp = 1, random = () => .9} = {}) {
    const drop = {item_id: '9', drop_rate: 20, is_ingredient: true, min_quantity: 2, max_quantity: 3};
    let state = {        
character: {id: '1', hp: 10, max_hp: 100, blood: 20, max_blood: 100, ap: 10, max_ap: 10, currency: 5, atk: 100, def: 1, agi: 100, status: 'ALIVE', death_count: 0},
        battle: {            
id: '3', character_id: '1', battle_status: 'ACTIVE', turn_no: 1, monster_hp: monsterHp, monster_atk: 200, monster_def: 0, monster_agi: 0,
            declaration: {name: '공격', action_type: 'ATTACK', multiplier: 1}, snapshot: {drops: [drop], actions: [], abilities: {}, monster: {name: '스냅샷 마물'}}        
}, inventory: 0, logs: [], battleLogs: []    
};
    let snapshot; const rows = r => ({rows: r, rowCount: r.length}); const calls = [];
    const c = {        
release() {}, async query(raw, p = []) {            
const dailyGateResult = dailyGateFixture(raw); if (dailyGateResult) return dailyGateResult; const sql = raw.replace(/\s+/g, ' ').trim(); calls.push(sql);
            if (sql === 'begin') {snapshot = structuredClone(state); return rows([]);} if (sql === 'rollback') {state = snapshot; return rows([]);} if (sql === 'commit') return rows([]);
            if (sql.startsWith('select c.*')) return rows([{...state.character}]);
            if (sql.startsWith('select id from public.action_log')) return rows(state.logs.filter(l => l.key === p[0]));
            if (sql.startsWith('select * from public.battle')) return rows([structuredClone(state.battle)]);
            if (sql.startsWith('update public.battle set battle_status')) {if (!expired) return rows([]); state.battle = {...state.battle, battle_status: 'DEFEAT', end_reason: 'TIMEOUT'}; return rows([state.battle]);}
            if (sql.startsWith('select * from public.item')) return rows([{id: '9', name: '식재료', is_active: true}]);
            if (sql.startsWith('update public.game_character')) {['hp', 'blood', 'ap', 'currency', 'status', 'death_count'].forEach((k, i) => state.character[k] = p[i]); return rows([{...state.character}]);}
            if (sql.startsWith('select id,quantity from public.inventory')) return rows(state.inventory ? [{id: '2', quantity: state.inventory}] : []);
            if (sql.startsWith('insert into public.inventory')) {state.inventory = p[2]; return rows([]);} if (sql.startsWith('update public.inventory')) {state.inventory = p[0]; return rows([]);}
            if (sql.startsWith('update public.battle set character_hp')) {Object.assign(state.battle, {character_hp: p[1], monster_hp: p[2], battle_status: p[3], end_reason: p[5], turn_no: p[6], declaration: JSON.parse(p[7])}); return rows([structuredClone(state.battle)]);}
            if (sql.startsWith('insert into public.battle_log')) {state.battleLogs.push({id: String(state.battleLogs.length + 1), turn_no: p[1]}); return rows([]);}
            if (sql.startsWith('insert into public.action_log')) {if (failLog && p[3] === 'BATTLE_COMMAND') throw Error('audit failed'); state.logs.push({key: p[8], action: p[3], detail: JSON.parse(p[7])}); return rows([]);}
            if (sql.startsWith('select * from public.battle_log')) return rows([...state.battleLogs].reverse());
            if (sql.startsWith('select detail from public.action_log')) return rows(state.logs.filter(l => l.action === 'BATTLE_COMMAND').slice(-1));
            throw Error(sql);
        }    
};
    return {repo: createBattleRepository({connect: async () => c}, {random}), state: () => state, calls};
}
test('simultaneous death victory atomically grants coin and guaranteed snapshot ingredient; reload preserves outcome', async () => {
    const f = fixture(), key = randomUUID(); const result = await f.repo.commandBattle('u', '3', {requestKey: key, turnNo: 1, action: 'ATTACK'});
    assert.equal(result.battle.battle_status, 'VICTORY'); assert.equal(result.character.status, 'DEAD'); assert.equal(result.character.death_count, 1);
    assert.equal(result.currencyReward, 2); assert.equal(result.character.currency, 7); assert.equal(result.rewards[0].guaranteed, true); assert.equal(result.rewards[0].quantity, 3); assert.equal(f.state().inventory, 3);
    const reload = await f.repo.getBattle('u', null, {latest: true}); assert.equal(reload.currencyReward, 2); assert.deepEqual(reload.rewards, result.rewards);
    const saved = structuredClone(f.state()); await assert.rejects(f.repo.commandBattle('u', '3', {requestKey: key, turnNo: 1, action: 'ATTACK'}), e => e.code === 'DUPLICATE_REQUEST');
    await assert.rejects(f.repo.commandBattle('u', '3', {requestKey: randomUUID(), turnNo: 1, action: 'ATTACK'}), e => e.code === 'BATTLE_FINISHED'); assert.deepEqual(f.state(), saved);
});
test('battle settlement audit failure rolls back battle, death, coins, drops and logs', async () => {
    const f = fixture({failLog: true}), before = structuredClone(f.state());
    await assert.rejects(f.repo.commandBattle('u', '3', {requestKey: randomUUID(), turnNo: 1, action: 'ATTACK'}), /audit failed/); assert.deepEqual(f.state(), before); assert.equal(f.calls.at(-1), 'rollback');
});
test('defeat, flee and timeout grant no victory rewards', async () => {
    for (const [options, action, status] of [[{monsterHp: 999}, 'ATTACK', 'DEFEAT'], [{random: () => 0}, 'FLEE', 'FLED'], [{expired: true}, 'ATTACK', 'DEFEAT']]) {
        const f = fixture(options); const r = await f.repo.commandBattle('u', '3', {requestKey: randomUUID(), turnNo: 1, action});
        assert.equal(r.battle.battle_status, status); assert.equal(f.state().character.currency, 5); assert.equal(f.state().inventory, 0); assert.deepEqual(r.rewards, []);
        if (options.expired) {assert.equal(r.battle.end_reason, 'TIMEOUT'); assert.equal(f.state().character.hp, 10);}
    }
});
test('stale turn rejects before any settlement', async () => {
    const f = fixture(), saved = structuredClone(f.state()); await assert.rejects(f.repo.commandBattle('u', '3', {requestKey: randomUUID(), turnNo: 2, action: 'ATTACK'}), e => e.code === 'STALE_BATTLE_TURN'); assert.deepEqual(f.state(), saved);
});
