import {dailyGateFixture} from './daily-gate-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAdminMasterRepository} from '../src/modules/admin/master-repository.js';

function fixture({admin = true, failLog = false} = {}) {
    let area = {id: '3', name: '지역', encounter_rate: 40, investigation_rate: 75, is_open: true, unlock_at: null};
    const calls = [], logs = [];
    let snapshot;
    const client = {release() {}, async query(sql, params = []) {const dailyGateResult=dailyGateFixture(sql);if(dailyGateResult)return dailyGateResult;
        sql = sql.replace(/\s+/g, ' ').trim(); calls.push({sql, params});
        const result = values => ({rows: values, rowCount: values.length});
        if (sql === 'begin') {snapshot = structuredClone(area); return result([]);}
        if (sql === 'commit') return result([]);
        if (sql === 'rollback') {area = snapshot; return result([]);}
        if (sql.startsWith('select id from public.area')) return result([{id: area.id}]);
        if (sql.startsWith('select id from public.auth_user')) return result(admin ? [{id: '1'}] : []);
        if (sql.startsWith('select id from public.action_log')) return result([]);
        if (sql.startsWith('select p.*')) return result([structuredClone(area)]);
        if (sql.startsWith('update public.area')) {
            const columns = sql.match(/set (.+) where/)[1].split(',').map(value => value.split('=')[0]);
            columns.forEach((column, i) => {area[column] = params[i];}); return result([]);
        }
        if (sql.startsWith('insert into public.action_log')) {
            if (failLog) throw Error('log failed');
            logs.push(JSON.parse(params[7])); return result([]);
        }
        throw Error(`Unexpected SQL: ${sql}`);
    }};
    return {repo: createAdminMasterRepository({connect: async () => client}), calls, logs, area: () => area};
}

test('manual relock and scheduled reopen preserve investigation rate and record before/after', async () => {
    const f = fixture();
    await f.repo.saveAdminMaster('1', 'areas', '3', {is_open: false}, randomUUID());
    assert.equal(f.area().is_open, false); assert.equal(f.area().investigation_rate, 75);
    await f.repo.saveAdminMaster('1', 'areas', '3', {is_open: true, unlock_at: '2026-11-03T00:00:00+09:00'}, randomUUID());
    assert.equal(f.area().is_open, true); assert.equal(f.area().investigation_rate, 75);
    assert.equal(f.logs[0].before.is_open, true); assert.equal(f.logs[0].after.is_open, false);
    assert.ok(f.calls.findIndex(c => c.sql.includes('from public.area where')) < f.calls.findIndex(c => c.sql.includes('from public.auth_user')));
});

test('area changes recheck ADMIN in transaction and rollback on audit error', async () => {
    const denied = fixture({admin: false});
    await assert.rejects(denied.repo.saveAdminMaster('1', 'areas', '3', {is_open: false}, randomUUID()), {code: 'ADMIN_REQUIRED'});
    assert.equal(denied.area().is_open, true);
    const broken = fixture({failLog: true});
    await assert.rejects(broken.repo.saveAdminMaster('1', 'areas', '3', {is_open: false}, randomUUID()), /log failed/);
    assert.equal(broken.area().is_open, true); assert.equal(broken.calls.at(-1).sql, 'rollback');
});
