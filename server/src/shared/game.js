import {enqueueSystemEvent} from '../modules/mastodon-system/outbox.js';
import {AppError} from './http.js';
import {bloodLimit} from './balance.js';
import {gameTransactionDay} from './daily-gate.js';

export async function lockCharacterByUser(client, userId) {
    const r = await client.query(
        `select c.*
     from public.game_character c
     join public.auth_user u on u.character_id=c.id
     where u.id=$1 and u.is_active and c.is_active
     for update of u,c`,
        [userId]
    );
    return r.rows[0] || null;
}

export async function lockCharacter(client, characterId) {
    const r = await client.query(
        `select *
     from public.game_character
     where id=$1 and is_active
     for update`,
        [characterId]
    );
    return r.rows[0] || null;
}

// Ownership is locked first; character rows are always locked in bigint ID order.
export async function lockCharacterPairByUser(client, userId, targetId) {
    const user = await client.query(
        'select character_id from public.auth_user where id=$1 and is_active for update', [userId]
    );
    const providerId = user.rows[0]?.character_id;
    if (!providerId) return {provider: null, target: null};
    const ids = [...new Set([String(providerId), String(targetId)])]
        .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
    const characters = new Map();
    for (const id of ids) characters.set(id, await lockCharacter(client, id));
    return {provider: characters.get(String(providerId)), target: characters.get(String(targetId))};
}

export function characterState(character) {
    return {
        id: String(character.id), hp: Number(character.hp), blood: Number(character.blood),
        status: character.status, death_count: Number(character.death_count),
        revive_count: Number(character.revive_count || 0)
    };
}

export async function changeCharacterResources(client, character, changes={}) {
    const hpChange = changes.hp || 0;
    const bloodChange = changes.blood || 0;
    const apChange = changes.ap || 0;
    const currencyChange = changes.currency || 0;

    const hp = Math.max(0, Math.min(Number(character.max_hp), Number(character.hp) + hpChange));
    const blood = bloodChange === 0 ? Number(character.blood)
        : Math.max(0, Math.min(bloodLimit(character), Number(character.blood) + bloodChange));
    const ap = Math.max(0, Math.min(Number(character.max_ap), Number(character.ap) + apChange));
    const currency = Math.max(0, Number(character.currency) + currencyChange);

    let status = character.status;
    let deathCount = Number(character.death_count);

    if (hp === 0 && character.status !== 'DEAD') {
        status = 'DEAD';
        deathCount += 1;
    } else if (status !== 'DEAD' && blood === 0) {
        status = 'NEAR_DEATH';
    } else if (status === 'NEAR_DEATH' && blood >= 1) {
        status = 'ALIVE';
    }

    const r = await client.query(
        `update public.game_character
     set hp=$1,blood=$2,ap=$3,currency=$4,status=$5,death_count=$6
     where id=$7
     returning *`,
        [hp,blood,ap,currency,status,deathCount,character.id]
    );

    const updated = r.rows[0];
    if (character.status !== 'DEAD' && status === 'DEAD') {
        await enqueueSystemEvent(client,{type:'death',key:`${character.id}:${deathCount}`,characterId:character.id,values:{character:character.name}});
        await writeActionLog(client, {
            characterId: character.id, category: 'CHARACTER', actionType: 'DEATH',
            targetType: 'CHARACTER', targetId: character.id, description: '캐릭터가 사망했습니다.',
            detail: {before: characterState(character), after: characterState(updated)}
        });
    }
    return updated;
}

export async function changeInventoryQuantity(client, characterId, itemId, delta) {
    const current = await client.query(
        `select id,quantity
     from public.inventory
     where character_id=$1 and item_id=$2
     for update`,
        [characterId,itemId]
    );

    const before = current.rowCount ? Number(current.rows[0].quantity) : 0;
    const after = before + delta;
    if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(after) || after > 2147483647) throw new AppError(409, 'INVENTORY_LIMIT_CONFLICT', '인벤토리 수량 저장 범위를 초과합니다.');

    if (after < 0) return {ok:false,before,after};

    if (current.rowCount) {
        await client.query(
            `update public.inventory
       set quantity=$1
       where id=$2`,
            [after,current.rows[0].id]
        );
    } else if (after > 0) {
        await client.query(
            `insert into public.inventory (character_id,item_id,quantity)
       values ($1,$2,$3)`,
            [characterId,itemId,after]
        );
    }

    return {ok:true,before,after};
}

export async function writeActionLog(client, {
    characterId=null,
    adminUserId=null,
    category,
    actionType,
    targetType=null,
    targetId=null,
    description,
    detail={},
    requestKey=null
}) {
    await client.query(
        `insert into public.action_log
     (character_id,admin_user_id,category,action_type,target_type,target_id,description,detail,request_key,created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,clock_timestamp())`,
        [
            characterId,
            adminUserId,
            category,
            actionType,
            targetType,
            targetId,
            description,
            JSON.stringify(gameTransactionDay(client) ? {...detail,dailyTransactionDay:gameTransactionDay(client)} : detail),
            requestKey
        ]
    );
}
