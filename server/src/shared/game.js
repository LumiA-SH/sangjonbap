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

export async function changeCharacterResources(client, character, changes={}) {
    const hpChange = changes.hp || 0;
    const bloodChange = changes.blood || 0;
    const apChange = changes.ap || 0;
    const currencyChange = changes.currency || 0;

    const hp = Math.max(0, Math.min(Number(character.max_hp), Number(character.hp) + hpChange));
    const blood = Math.max(0, Math.min(Number(character.max_blood), Number(character.blood) + bloodChange));
    const ap = Math.max(0, Math.min(Number(character.max_ap), Number(character.ap) + apChange));
    const currency = Math.max(0, Number(character.currency) + currencyChange);

    let status = character.status;
    let deathCount = Number(character.death_count);

    if (hp === 0 && character.status !== 'DEAD') {
        status = 'DEAD';
        deathCount += 1;
    } else if (status !== 'DEAD' && blood === 0) {
        status = 'NEAR_DEATH';
    }

    const r = await client.query(
        `update public.game_character
     set hp=$1,blood=$2,ap=$3,currency=$4,status=$5,death_count=$6
     where id=$7
     returning *`,
        [hp,blood,ap,currency,status,deathCount,character.id]
    );

    return r.rows[0];
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
     (character_id,admin_user_id,category,action_type,target_type,target_id,description,detail,request_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [
            characterId,
            adminUserId,
            category,
            actionType,
            targetType,
            targetId,
            description,
            JSON.stringify(detail),
            requestKey
        ]
    );
}