import {AppError} from '../../shared/http.js';
import {randomUnit} from '../investigation/random.js';

const fail=(code,message)=>{throw new AppError(409,code,message);};
export const attackDamage=(atk,def,r)=>Math.max(1,Math.floor(atk*1.25+r-def*0.5));
export const monsterDamage=(atk,def,r,multiplier=1)=>Math.max(1,Math.floor(Math.max(1,Math.floor(atk+r-def))*multiplier));
export const escapeChance=(pcAgi,monsterAgi)=>Math.max(15,Math.min(85,50+(pcAgi-monsterAgi)*2));
export function commandOptions(declaration) {
    return declaration.action_type==='FLEE'?['ATTACK','ABILITY','ITEM','FLEE','BLOCK_FLEE']:['ATTACK','DEFEND','ABILITY','ITEM','FLEE'];
}
export function sampleUnit(random=randomUnit) {
    const value=random();
    if(!Number.isFinite(value)||value<0||value>=1)throw new Error('RNG must be in [0,1)');
    return value;
}

// Pure turn calculation. The repository owns locks, item consumption, state
// transitions, rewards and commit. Random rolls are returned for audit.
export function resolveTurn({character,monster,declaration,action,ability,item},random=randomUnit) {
    if(!commandOptions(declaration).includes(action))fail('INVALID_BATTLE_ACTION','이번 마물 행동에 사용할 수 없는 행동입니다.');
    if(character.status==='DEAD'||character.hp<=0||character.blood<=0)fail('BATTLE_CHARACTER_UNAVAILABLE','행동할 수 없는 캐릭터입니다.');
    if(!['ATTACK','SPECIAL_ATTACK','FLEE'].includes(declaration.action_type))fail('BATTLE_CONFIG_INVALID','지원하지 않는 마물 행동입니다.');
    const rolls=[];
    const die=label=>{const value=1+Math.floor(sampleUnit(random)*10);rolls.push({label,value});return value;};
    const percent=label=>{const value=sampleUnit(random)*100;rolls.push({label,value});return value;};
    let hp=Number(character.hp),blood=Number(character.blood),ap=Number(character.ap),monsterHp=Number(monster.hp);
    let pcDamage=0,enemyDamage=0,defended=false,fledActor=null;
    const enemyAttacks=declaration.action_type!=='FLEE';
    if(action==='ATTACK'||action==='ABILITY') {
        if(blood<5)fail('NOT_ENOUGH_BLOOD','공격에 혈량 5가 필요합니다.');
        if(action==='ABILITY') {
            if(!character.has_ability||!character.ability_grade)fail('ABILITY_UNAVAILABLE','이능을 보유하지 않았습니다.');
            if(!ability||!Number.isFinite(ability.multiplier)||ability.multiplier<=0||!Number.isInteger(ability.ap_cost)||ability.ap_cost<0)
                fail('BATTLE_CONFIG_INVALID','이능 설정을 확인하세요.');
            if(ap<ability.ap_cost)fail('NOT_ENOUGH_AP','이능공격에 필요한 AP가 부족합니다.');
            ap-=ability.ap_cost;
        }
        blood-=5;
        const base=attackDamage(character.atk,monster.def,die('pc_attack'));
        pcDamage=action==='ABILITY'?Math.max(1,Math.floor(base*ability.multiplier)):base;
    } else if(action==='DEFEND') {
        defended=Number(character.def)+die('defend_pc')>=Number(monster.atk)+die('defend_monster');
        if(defended)pcDamage=Math.max(1,Math.floor(attackDamage(character.atk,monster.def,die('counter'))*0.4));
    } else if(action==='ITEM') {
        if(!item?.is_active||!item.usable||!item.battle_usable||item.use_target!=='SELF'||
            !Number.isInteger(item.effect_value)||item.effect_value<=0)fail('BATTLE_ITEM_UNAVAILABLE','전투에서 사용할 수 없는 아이템입니다.');
        if(item.effect_type==='BLOOD_PACK')blood=Math.min(200,Number(character.max_blood),blood+item.effect_value);
        else fail('BATTLE_ITEM_EFFECT_HOLD','정의되지 않은 전투 아이템 효과입니다.');
    } else if(action==='FLEE') {
        // On a monster flee declaration both sides leave without a random check.
        if(!enemyAttacks||percent('pc_flee')<escapeChance(character.agi,monster.agi))fledActor='PC';
    } else if(action==='BLOCK_FLEE') {
        if(percent('block_flee')>=escapeChance(character.agi,monster.agi))fledActor='MONSTER';
    }
    if(!enemyAttacks&&action!=='BLOCK_FLEE'&&!fledActor)fledActor='MONSTER';
    if(enemyAttacks&&!defended&&!fledActor) {
        const multiplier=declaration.action_type==='SPECIAL_ATTACK'?Number(declaration.multiplier):1;
        if(!Number.isFinite(multiplier)||multiplier<=0)fail('BATTLE_CONFIG_INVALID','특수공격 배율을 확인하세요.');
        enemyDamage=monsterDamage(monster.atk,character.def,die('monster_attack'),multiplier);
    }
    hp=Math.max(0,hp-enemyDamage);monsterHp=Math.max(0,monsterHp-pcDamage);
    // Victory has priority, even when the declared attack kills the PC.
    const status=monsterHp===0?'VICTORY':hp===0||blood===0?'DEFEAT':fledActor?'FLED':'ACTIVE';
    return {hp,blood,ap,monsterHp,status,fledActor:status==='FLED'?fledActor:null,
        reason:status==='VICTORY'?'MONSTER_KILLED':status==='DEFEAT'?(hp===0?'PC_DEAD':'PC_NEAR_DEATH'):status==='FLED'?'ESCAPED':null,
        pcDamage,enemyDamage,defended,rolls};
}

export function chooseMonsterAction(actions,random=randomUnit) {
    const active=actions.filter(a=>a.is_active!==false);
    if(active.some(a=>!['ATTACK','SPECIAL_ATTACK','FLEE'].includes(a.action_type)||
        (a.action_type==='SPECIAL_ATTACK'&&(!Number.isFinite(Number(a.multiplier))||Number(a.multiplier)<=0))))
        fail('BATTLE_CONFIG_INVALID','마물 행동 종류 또는 배율이 올바르지 않습니다.');
    if(active.some(a=>a.condition_type!=null))fail('MONSTER_CONDITION_HOLD','조건부 행동의 판정 규칙 확인이 필요합니다.');
    const total=active.reduce((n,a)=>n+Number(a.probability),0);
    if(!active.length||active.some(a=>!Number.isFinite(Number(a.probability))||Number(a.probability)<0)||Math.abs(total-100)>0.000001)
        fail('BATTLE_CONFIG_INVALID','활성 마물 행동 확률의 합은 100이어야 합니다.');
    let cursor=sampleUnit(random)*100;
    for(const action of active){cursor-=Number(action.probability);if(cursor<0)return action;}
    return active.at(-1);
}
