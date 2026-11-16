import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRaidDamage} from '../src/modules/admin/raid-repository.js';
import {attackDamage} from '../src/modules/battle/engine.js';

test('레이드 일반공격은 기존 PVE 공격식을 그대로 사용한다', () => {
    const input = {action: 'ATTACK', atk: 30, bossDef: 10, roll: 7};
    assert.equal(calculateRaidDamage(input), attackDamage(30, 10, 7));
});

test('레이드 이능공격은 일반공격 결과에 서버 등급 배율을 적용한다', () => {
    const base = attackDamage(30, 10, 7);
    assert.equal(calculateRaidDamage({action: 'ABILITY', atk: 30, bossDef: 10, roll: 7,
        abilityGrade: 'B', multiplier: 1.8}), Math.max(1, Math.floor(base * 1.8)));
});

test('방어력이 커도 최소 데미지는 1이다', () => {
    assert.equal(calculateRaidDamage({action: 'ATTACK', atk: 0, bossDef: 500, roll: 1}), 1);
});
