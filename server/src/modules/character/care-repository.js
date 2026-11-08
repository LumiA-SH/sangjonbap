import {beginGameTransaction, commitGameTransaction, rollbackGameTransaction} from '../../shared/daily-gate.js';
import {AppError} from '../../shared/http.js';
import {lockCharacterPairByUser, changeCharacterResources, characterState, writeActionLog} from '../../shared/game.js';

import {readNumberSettings, resourceNumber, positiveResourceNumber} from '../../shared/settings.js';

const duplicateRequest = () => new AppError(409, 'DUPLICATE_REQUEST', '이미 처리된 요청입니다.');

async function rejectDuplicate(client, requestKey) {
    const existing = await client.query('select id from public.action_log where request_key=$1', [requestKey]);
    if (existing.rowCount) throw duplicateRequest();
}

export function createCharacterCareRepository(pool) {
    return {
        async performCharacterCare(userId, targetId, requestKey, action, validateLocked) {
            const client = await pool.connect();
            try {
                await beginGameTransaction(client);
                await rejectDuplicate(client, requestKey);
                const {provider, target} = await lockCharacterPairByUser(client, userId, targetId);
                await rejectDuplicate(client, requestKey);
                const settings = await readNumberSettings(client, action === 'REVIVE' ? {
                    revive_blood_cost: resourceNumber, revive_hp: positiveResourceNumber, revive_blood: positiveResourceNumber
                } : {heal_blood_cost: resourceNumber, heal_hp_recovery: resourceNumber});
                const plan = validateLocked(provider, target, settings);
                const sameCharacter = String(provider.id) === String(target.id);
                if (!sameCharacter || action==='HEAL') {
                    // Lock all existing battles, including finished ones, so an
                    // ACTIVE transition cannot race this decision. The character
                    // FOR UPDATE lock also serializes FK-checked battle inserts.
                    // Future battle writers must lock character -> battle.
                    const battles = await client.query(
                        'select id,battle_status from public.battle where character_id=$1 order by id for share',
                        [target.id]
                    );
                    if (battles.rows.some(battle => battle.battle_status === 'ACTIVE')) {
                        throw new AppError(409, 'TARGET_IN_ACTIVE_BATTLE', '전투 중인 대상에게 외부 개입할 수 없습니다.');
                    }
                }
                if(!sameCharacter) {
                    const active=await client.query("select id from public.battle where character_id=$1 and battle_status='ACTIVE' for share",[provider.id]);
                    if(active.rowCount)throw new AppError(409,'PROVIDER_IN_ACTIVE_BATTLE','전투 중에는 일반 치료를 제공할 수 없습니다.');
                }
                let providerAfter;
                let targetAfter;
                if (sameCharacter) {
                    providerAfter = await changeCharacterResources(client, provider, {
                        ...plan.targetChanges, blood: -plan.cost
                    });
                    targetAfter = providerAfter;
                } else {
                    providerAfter = await changeCharacterResources(client, provider, {blood: -plan.cost});
                    targetAfter = await changeCharacterResources(client, target, plan.targetChanges);
                }
                if (plan.revive) {
                    // Only the locked, validated revive operation can clear DEAD.
                    const restored = await client.query(
                        "update public.game_character set status='ALIVE',revive_count=revive_count+1 where id=$1 returning *",
                        [target.id]
                    );
                    targetAfter = restored.rows[0];
                }
                const result = {provider: characterState(providerAfter), target: characterState(targetAfter)};
                await writeActionLog(client, {
                    characterId: provider.id, category: 'CHARACTER', actionType: action,
                    targetType: 'CHARACTER', targetId: target.id,
                    description: plan.revive ? '캐릭터를 부활시켰습니다.' : '캐릭터를 치료했습니다.',
                    detail: {
                        provider_id: String(provider.id), target_id: String(target.id), blood_cost: plan.cost,
                        before: {provider: characterState(provider), target: characterState(target)}, after: result
                    },
                    requestKey
                });
                await commitGameTransaction(client);
                return result;
            } catch (error) {
                await rollbackGameTransaction(client);
                if (error?.code === '23505' && error?.constraint === 'action_log_request_key_key') throw duplicateRequest();
                throw error;
            } finally {
                client.release();
            }
        }
    };
}
