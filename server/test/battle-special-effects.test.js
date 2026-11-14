import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveTurn,
    escapeChance,
    chooseMonsterAction
} from '../src/modules/battle/engine.js';

const pc = {
    hp: 100,
    max_hp: 100,
    blood: 100,
    max_blood: 100,
    ap: 10,
    atk: 20,
    def: 10,
    agi: 10,
    status: 'ALIVE',
    has_ability: true,
    ability_grade: 'B'
};

const monster = {
    hp: 100,
    atk: 20,
    def: 10,
    agi: 10
};

const attack = {
    name: '일반공격',
    action_type: 'ATTACK',
    multiplier: 1
};

const stunned = {
    name: '기절 · 행동 불가',
    action_type: 'STUNNED',
    multiplier: 1
};

function combatItem(type, value, target = 'OTHER') {
    return {
        name: type,
        category: 'CONSUMABLE',
        is_active: true,
        usable: true,
        battle_usable: true,
        use_target: target,
        effect_type: type,
        effect_value: value
    };
}

function turn(options = {}) {
    return resolveTurn({
        character: pc,
        monster,
        declaration: attack,
        action: 'ATTACK',
        ...options
    }, () => 0);
}

test('복수 특수공격은 각 행동의 배율과 가중치로 판정한다', () => {
    const actions = [
        {name: '일반공격', action_type: 'ATTACK', probability: 50},
        {name: '강타', action_type: 'SPECIAL_ATTACK', probability: 25, multiplier: 1.5},
        {name: '회전공격', action_type: 'SPECIAL_ATTACK', probability: 25, multiplier: 2}
    ];

    assert.equal(chooseMonsterAction(actions, () => 0.1).name, '일반공격');
    assert.equal(chooseMonsterAction(actions, () => 0.6).name, '강타');
    assert.equal(chooseMonsterAction(actions, () => 0.9).name, '회전공격');

    const special = turn({
        declaration: {action_type: 'SPECIAL_ATTACK', multiplier: 2}
    });

    assert.equal(special.enemyDamage, 22);
});

test('고정 피해는 방어력을 무시하며 동시 피해 규칙을 유지한다', () => {
    const result = turn({
        action: 'ITEM',
        character: {...pc, hp: 1},
        monster: {...monster, hp: 40, def: 1000},
        item: combatItem('FIXED_DAMAGE', 50)
    });

    assert.equal(result.pcDamage, 50);
    assert.equal(result.monsterHp, 0);
    assert.equal(result.hp, 0);
    assert.equal(result.status, 'VICTORY');
    assert.equal(result.ap, 10);
});

test('기절 아이템 사용 턴의 기존 마물 선언은 처리한다', () => {
    const result = turn({
        action: 'ITEM',
        item: combatItem('STUN', 2)
    });

    assert.equal(result.enemyDamage, 11);
    assert.equal(result.statusEffects.stunRemaining, 2);
    assert.equal(result.ap, 10);
});

test('기절은 이후 마물 행동 2회를 취소하고 사라진다', () => {
    const first = turn({
        declaration: stunned,
        statusEffects: {stunRemaining: 2},
        action: 'ATTACK'
    });

    assert.equal(first.stunSkipped, true);
    assert.equal(first.enemyDamage, 0);
    assert.equal(first.statusEffects.stunRemaining, 1);

    const second = turn({
        declaration: stunned,
        statusEffects: first.statusEffects,
        action: 'ATTACK'
    });

    assert.equal(second.enemyDamage, 0);
    assert.equal(second.statusEffects.stunRemaining, 0);
});

test('기절 중 추가 기절 아이템 사용은 취소 횟수를 갱신한다', () => {
    const result = turn({
        declaration: stunned,
        statusEffects: {stunRemaining: 1},
        action: 'ITEM',
        item: combatItem('STUN', 2)
    });

    assert.equal(result.enemyDamage, 0);
    assert.equal(result.statusEffects.stunRemaining, 2);
});

test('중독은 사용한 턴이 아닌 다음 턴부터 3회 피해를 준다', () => {
    const first = turn({
        action: 'ITEM',
        item: combatItem('POISON', 10)
    });

    assert.equal(first.poisonDamage, 0);
    assert.equal(first.statusEffects.poisonRemaining, 3);

    let effects = first.statusEffects;

    for (const remaining of [2, 1, 0]) {
        const result = turn({
            action: 'DEFEND',
            character: {...pc, def: 100},
            statusEffects: effects
        });

        assert.equal(result.poisonDamage, 10);
        assert.equal(result.statusEffects.poisonRemaining, remaining);
        effects = result.statusEffects;
    }
});

test('기절 중에도 중독 피해를 적용한다', () => {
    const result = turn({
        declaration: stunned,
        action: 'DEFEND',
        statusEffects: {
            stunRemaining: 1,
            poisonRemaining: 2
        }
    });

    assert.equal(result.enemyDamage, 0);
    assert.equal(result.poisonDamage, 10);
    assert.equal(result.statusEffects.poisonRemaining, 1);
});

test('중독으로 마물 HP가 0이 되면 승리한다', () => {
    const result = turn({
        monster: {...monster, hp: 8},
        statusEffects: {poisonRemaining: 1},
        action: 'ITEM',
        item: combatItem('STUN', 1)
    });

    assert.equal(result.pcDamage, 0);
    assert.equal(result.poisonDamage, 8);
    assert.equal(result.monsterHp, 0);
    assert.equal(result.status, 'VICTORY');
});

test('중독 재사용은 남은 횟수를 3턴으로 갱신한다', () => {
    const result = turn({
        action: 'ITEM',
        statusEffects: {poisonRemaining: 1},
        item: combatItem('POISON', 10)
    });

    assert.equal(result.poisonDamage, 10);
    assert.equal(result.statusEffects.poisonRemaining, 3);
});

test('연막은 다음 도주 확률을 %p로 높이며 한 번만 적용된다', () => {
    const prepared = turn({
        action: 'ITEM',
        item: combatItem('SMOKE', 60, 'SELF')
    });

    assert.equal(prepared.statusEffects.smokeBonus, 60);

    const escaped = resolveTurn({
        character: pc,
        monster,
        declaration: attack,
        action: 'FLEE',
        statusEffects: prepared.statusEffects
    }, () => 0.9);

    assert.equal(escapeChance(10, 10), 50);
    assert.equal(escaped.status, 'FLED');
    assert.equal(escaped.statusEffects.smokeBonus, 0);
    assert.equal(escaped.enemyDamage, 0);
});

test('연막은 중첩되지 않고 새 설정값으로 대체된다', () => {
    const result = turn({
        action: 'ITEM',
        item: combatItem('SMOKE', 30, 'SELF'),
        statusEffects: {smokeBonus: 70}
    });

    assert.equal(result.statusEffects.smokeBonus, 30);
});

test('사용할 수 없는 아이템 효과는 거부한다', () => {
    assert.throws(
        () => turn({
            action: 'ITEM',
            item: combatItem('STUN', 3)
        }),
        error => error.code === 'BATTLE_ITEM_CONFIG_INVALID'
    );

    assert.throws(
        () => turn({
            action: 'ITEM',
            item: {...combatItem('POISON', 10), battle_usable: false}
        }),
        error => error.code === 'BATTLE_ITEM_UNAVAILABLE'
    );
});