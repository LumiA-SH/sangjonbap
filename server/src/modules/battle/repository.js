import {AppError} from '../../shared/http.js';
import {actionTransaction, requireActionCharacter, rejectActionDuplicate} from '../../shared/actions.js';
import {lockCharacterByUser, lockCharacter, changeCharacterResources, changeInventoryQuantity, writeActionLog} from '../../shared/game.js';
import {readNumberSettings, resourceNumber} from '../../shared/settings.js';
import {resolveTurn, chooseMonsterAction, commandOptions, sampleUnit} from './engine.js';
import {randomUnit} from '../investigation/random.js';
import {lockRecipeDrops,discoverRecipe,filterDiscoveredRecipeDrops} from '../../shared/recipes.js';
import {requireIngredientDrops,victoryCurrency,guaranteedIngredient} from './rewards.js';

const fail = (code, message, status=409) => {throw new AppError(status, code, message);};
const idOrder = (a,b) => BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0;
export const abilityRequirements = Object.fromEntries('edcbas'.split('').flatMap(grade => [
    [`battle_ability_${grade}_multiplier`, {min:0.01,max:1000}],
    [`battle_ability_${grade}_ap_cost`, resourceNumber]
]));

export function battleView(battle) {
    if (!battle) return null;
    const {snapshot, ...view} = battle;
    return {...view, monster: snapshot?.monster || null,
        options: battle.battle_status==='ACTIVE' && battle.declaration ? commandOptions(battle.declaration) : []};
}

export function createBattleRepository(pool, {random=randomUnit}={}) {
    async function expire(client, battle) {
        if (!battle || battle.battle_status!=='ACTIVE') return battle;
        const result=await client.query(`update public.battle set battle_status='DEFEAT',end_reason='TIMEOUT',
            ended_at=clock_timestamp(),updated_at=clock_timestamp()
            where id=$1 and coalesce(last_command_at,started_at)<=clock_timestamp()-interval '24 hours' returning *`,[battle.id]);
        if (!result.rowCount) return battle;
        await client.query(`insert into public.battle_log(battle_id,turn_no,actor_type,action_type,message)
            values($1,$2,'SYSTEM','TIMEOUT','24시간 미행동으로 패배')`,[battle.id,battle.turn_no]);
        await writeActionLog(client,{characterId:battle.character_id,category:'BATTLE',actionType:'BATTLE_TIMEOUT',
            targetType:'BATTLE',targetId:battle.id,description:'24시간 미행동으로 패배',detail:{turn:battle.turn_no}});
        return result.rows[0];
    }

    async function ensureNoActiveBattle(client, character) {
        const row=(await client.query("select * from public.battle where character_id=$1 and battle_status='ACTIVE' for update",[character.id])).rows[0];
        // No expiry here: throwing for an active battle would roll back the timeout.
        if (row) fail('BATTLE_ACTIVE','진행 중인 전투를 먼저 확인하고 종료하세요.');
    }

    async function encounter(client, area, character) {
        const rate=Number(area.encounter_rate);
        if (!Number.isFinite(rate)||rate<0||rate>100) fail('BATTLE_CONFIG_INVALID','조우 확률이 올바르지 않습니다.');
        if (rate===0 || sampleUnit(random)*100>=rate) return null;
        // Investigation holds the area and character. Admin edits lock areas before monsters.
        const candidates=(await client.query(`select m.*,am.weight from public.area_monster am
            join public.monster m on m.id=am.monster_id where am.area_id=$1 and m.is_active
            order by m.id for update of m`,[area.id])).rows;
        if (!candidates.length) fail('MONSTER_CONFIG_MISSING','조우할 마물이 등록되지 않았습니다.');
        if (candidates.some(m=>!Number.isInteger(m.weight)||m.weight<=0)) fail('BATTLE_CONFIG_INVALID','출현 가중치가 올바르지 않습니다.');
        let cursor=sampleUnit(random)*candidates.reduce((n,m)=>n+m.weight,0);
        const monster=candidates.find(m=>(cursor-=m.weight)<0) || candidates.at(-1);
        if (!Number.isInteger(monster.max_hp)||monster.max_hp<=0||['atk','def','agi'].some(k=>!Number.isInteger(monster[k])||monster[k]<0))
            fail('BATTLE_CONFIG_INVALID','마물 스탯이 올바르지 않습니다.');
        const actions=(await client.query('select * from public.monster_action where monster_id=$1 order by sort_order,id',[monster.id])).rows;
        const declaration=chooseMonsterAction(actions,random);
        const drops=await filterDiscoveredRecipeDrops(client,(await client.query('select * from public.monster_drop where monster_id=$1 order by item_id,id',[monster.id])).rows);
        if (drops.some(d=>!Number.isFinite(Number(d.drop_rate))||Number(d.drop_rate)<0||Number(d.drop_rate)>100||
            !Number.isInteger(d.min_quantity)||d.min_quantity<1||!Number.isInteger(d.max_quantity)||d.max_quantity<d.min_quantity))
            fail('BATTLE_CONFIG_INVALID','드롭 설정이 올바르지 않습니다.');
        const abilities=await readNumberSettings(client,abilityRequirements);
        requireIngredientDrops(drops);
        const snapshot={monster,actions,drops,abilities};
        const battle=(await client.query(`insert into public.battle(character_id,monster_id,area_id,character_hp,
            monster_hp,monster_max_hp,monster_atk,monster_def,monster_agi,snapshot,declaration)
            values($1,$2,$3,$4,$5,$5,$6,$7,$8,$9::jsonb,$10::jsonb) returning *`,
            [character.id,monster.id,area.id,character.hp,monster.max_hp,monster.atk,monster.def,monster.agi,JSON.stringify(snapshot),JSON.stringify(declaration)])).rows[0];
        await client.query(`update public.monster set first_discoverer_id=$1,discovered_at=clock_timestamp()
            where id=$2 and first_discoverer_id is null`,[character.id,monster.id]);
        await writeActionLog(client,{characterId:character.id,category:'BATTLE',actionType:'BATTLE_START',
            targetType:'BATTLE',targetId:battle.id,description:'마물 조우',detail:{areaId:area.id,monsterId:monster.id,declaration}});
        return battleView(battle);
    }

    return {
        ensureNoActiveBattle, encounter,
        getBattle(userId, id=null, {latest=false}={}) {
            return actionTransaction(pool,async client=>{
                const character=await lockCharacterByUser(client,userId);
                if (!character) fail('CHARACTER_NOT_FOUND','연결된 활성 캐릭터가 없습니다.',404);
                const battle=(await client.query(`select * from public.battle where character_id=$1
                    and ${id?'id=$2':latest?'true':"battle_status='ACTIVE'"} order by id desc limit 1 for update`,id?[character.id,id]:[character.id])).rows[0];
                if (id&&!battle) fail('BATTLE_NOT_FOUND','전투를 찾을 수 없습니다.',404);
                const current=await expire(client,battle);
                const logs=current?(await client.query('select * from public.battle_log where battle_id=$1 order by id desc limit 100',[current.id])).rows.reverse():[];
                const outcome=current?.battle_status==='VICTORY'?(await client.query(`select detail from public.action_log
                    where character_id=$1 and target_type='BATTLE' and target_id=$2 and action_type='BATTLE_COMMAND'
                    order by id desc limit 1`,[character.id,current.id])).rows[0]?.detail:null;
                return {battle:battleView(current),character,logs,rewards:outcome?.rewards||[],currencyReward:outcome?.currencyReward||0};
            });
        },
        commandBattle(userId,id,{requestKey,turnNo,action,itemId}) {
            return actionTransaction(pool,async client=>{
                const before=await lockCharacterByUser(client,userId);
                if (!before) fail('CHARACTER_NOT_FOUND','연결된 활성 캐릭터가 없습니다.',404);
                await rejectActionDuplicate(client,requestKey);
                let battle=(await client.query('select * from public.battle where id=$1 and character_id=$2 for update',[id,before.id])).rows[0];
                if (!battle) fail('BATTLE_NOT_FOUND','전투를 찾을 수 없습니다.',404);
                if (battle.battle_status!=='ACTIVE') fail('BATTLE_FINISHED','이미 종료된 전투입니다.');
                battle=await expire(client,battle);
                if (battle.battle_status!=='ACTIVE') return {battle:battleView(battle),character:before,rewards:[]};
                if (battle.turn_no!==turnNo) fail('STALE_BATTLE_TURN','이미 처리된 턴입니다. 전투를 다시 조회하세요.');
                if (!battle.snapshot||!battle.declaration) fail('LEGACY_BATTLE_HOLD','스냅샷이 없는 기존 전투는 운영자 확인이 필요합니다.');
                requireActionCharacter(before);
                const recipes=await lockRecipeDrops(client,battle.snapshot.drops);
                // Lock all possible item rows once in ascending order, including drops.
                const itemIds=[...new Set([...battle.snapshot.drops.filter(d=>d.item_id!=null).map(d=>String(d.item_id)),...(action==='ITEM'?[itemId]:[])])].sort(idOrder);
                const items=new Map();
                for (const itemId of itemIds) items.set(itemId,(await client.query('select * from public.item where id=$1 for update',[itemId])).rows[0]);
                const grade=before.ability_grade?.toLowerCase(),settings=battle.snapshot.abilities;
                const resolved=resolveTurn({character:before,monster:{hp:battle.monster_hp,atk:battle.monster_atk,def:battle.monster_def,agi:battle.monster_agi},
                    declaration:battle.declaration,action,item:items.get(itemId),
                    ability:grade?{multiplier:settings[`battle_ability_${grade}_multiplier`],ap_cost:settings[`battle_ability_${grade}_ap_cost`]}:null},random);
                if (action==='ITEM') {
                    const used=await changeInventoryQuantity(client,before.id,itemId,-1);
                    if (!used.ok) fail('NOT_ENOUGH_ITEMS','아이템이 부족합니다.');
                }
                const currencyReward=resolved.status==='VICTORY'?victoryCurrency(random):0;
                if(Number(before.currency)+currencyReward>2147483647)fail('CURRENCY_LIMIT_CONFLICT','재화 저장 범위를 초과합니다.');
                const character=await changeCharacterResources(client,before,{hp:resolved.hp-before.hp,blood:resolved.blood-before.blood,ap:resolved.ap-before.ap,currency:currencyReward});
                const rewards=[];
                if (resolved.status==='VICTORY') for (const drop of battle.snapshot.drops) {
                    if(drop.recipe_id!=null&&!recipes.has(String(drop.recipe_id)))continue;
                    if (sampleUnit(random)*100>=Number(drop.drop_rate)) continue;
                    if(drop.recipe_id!=null) {
                        const found=await discoverRecipe(client,before.id,recipes.get(String(drop.recipe_id)),'BATTLE',id);
                        recipes.delete(String(drop.recipe_id));
                        if(found)rewards.push(found);
                        continue;
                    }
                    const item=items.get(String(drop.item_id));
                    if (!item) fail('BATTLE_REWARD_UNAVAILABLE','스냅샷 보상 아이템이 없습니다.');
                    const quantity=drop.min_quantity+Math.floor(sampleUnit(random)*(drop.max_quantity-drop.min_quantity+1));
                    await changeInventoryQuantity(client,before.id,item.id,quantity);
                    rewards.push({itemId:item.id,name:item.name,quantity,isIngredient:drop.is_ingredient});
                }
                if(resolved.status==='VICTORY'&&!rewards.some(row=>row.isIngredient)) {
                    const {drop,quantity}=guaranteedIngredient(battle.snapshot.drops,random);
                    const item=items.get(String(drop.item_id));
                    if(!item)fail('BATTLE_REWARD_UNAVAILABLE','스냅샷 식재료가 없습니다.');
                    await changeInventoryQuantity(client,before.id,item.id,quantity);
                    rewards.push({itemId:item.id,name:item.name,quantity,isIngredient:true,guaranteed:true});
                }
                const next=resolved.status==='ACTIVE'?chooseMonsterAction(battle.snapshot.actions,random):null;
                const after=(await client.query(`update public.battle set character_hp=$2,monster_hp=$3,battle_status=$4::varchar,
                    fled_actor_type=$5,end_reason=$6,turn_no=$7,declaration=$8::jsonb,last_command_at=clock_timestamp(),
                    ended_at=case when $4::varchar='ACTIVE' then null else clock_timestamp() end,updated_at=clock_timestamp()
                    where id=$1 returning *`,[id,character.hp,resolved.monsterHp,resolved.status,resolved.fledActor,resolved.reason,
                    next?turnNo+1:turnNo,JSON.stringify(next)])).rows[0];
                for (const [actor,type,damage] of [['PC',action,resolved.pcDamage],['MONSTER',battle.declaration.action_type,resolved.enemyDamage]]) {
                    const appliedDamage=Math.min(damage,actor==='PC'?battle.monster_hp:before.hp);
                    await client.query(`insert into public.battle_log(battle_id,turn_no,actor_type,action_type,message,damage)
                        values($1,$2,$3,$4,$5,$6)`,[id,turnNo,actor,type,`${type}: ${resolved.status}`,appliedDamage]);
                }
                await writeActionLog(client,{characterId:before.id,category:'BATTLE',actionType:'BATTLE_COMMAND',targetType:'BATTLE',targetId:id,
                    description:'전투 턴 처리',detail:{turnNo,action,itemId,declaration:battle.declaration,before:{hp:before.hp,blood:before.blood,ap:before.ap},resolved,rewards,currencyReward},requestKey});
                return {battle:battleView(after),character,rewards,currencyReward,resolved};
            });
        },
        async expireBattles() {
            const due=(await pool.query(`select id,character_id from public.battle where battle_status='ACTIVE'
                and coalesce(last_command_at,started_at)<=clock_timestamp()-interval '24 hours' order by character_id limit 100`)).rows;
            for (const row of due) await actionTransaction(pool,async client=>{
                await lockCharacter(client,row.character_id);
                const battle=(await client.query('select * from public.battle where id=$1 for update',[row.id])).rows[0];
                await expire(client,battle);
            });
            return due.length;
        }
    };
}
