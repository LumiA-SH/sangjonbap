import {AppError} from '../../shared/http.js';
import {actionTransaction, rejectActionDuplicate, requireActionCharacter, requireNoActiveBattle} from '../../shared/actions.js';
import {lockCharacterPairByUser, changeCharacterResources, writeActionLog} from '../../shared/game.js';
import {readNumberSettings, resourceNumber, positiveResourceNumber} from '../../shared/settings.js';
import {planCare} from './care-service.js';

const fail = (code, message, status = 409) => {
 throw new AppError(status, code, message);
};

export function validPublicId(id) {
 return typeof id === 'string' && /^[1-9][0-9]{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
}

export function validateCoinTransfer(id, body) {
 if (!validPublicId(id)) {
  fail('INVALID_CHARACTER_ID', '올바른 캐릭터 ID가 필요합니다.', 400);
 }

 if (!body || Array.isArray(body) || Object.keys(body).some(k => !['quantity', 'requestKey'].includes(k)) ||
     !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 2147483647) {
  fail('INVALID_COIN_QUANTITY', '코인은 1~2147483647 사이 정수로 입력하세요.', 400);
 }

 if (typeof body.requestKey !== 'string' ||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey)) {
  fail('INVALID_REQUEST_KEY', '요청 식별자가 필요합니다.', 400);
 }
}

export function createInteractionRepository(pool) {
 async function getPublicCharacter(userId, id) {
  if (!validPublicId(id)) {
   fail('INVALID_CHARACTER_ID', '올바른 캐릭터 ID가 필요합니다.', 400);
  }

  // Explicit projection; one snapshot; no auth identifiers, balances or private fields.
  const result = await pool.query(`
   select
    c.id::text, c.name, c.status, c.hp, c.max_hp, c.blood,
    least(c.max_blood, 100) max_blood, c.ap, c.max_ap,
    c.atk, c.def, c.agi,
    exists(
     select 1
     from public.battle b
     where b.character_id = c.id and b.battle_status = 'ACTIVE'
    ) in_active_battle,
    coalesce((
              select jsonb_agg(
                         jsonb_build_object(
                             'itemId', i.item_id::text,
                             'name', m.name,
                             'quantity', i.quantity
                         ) order by i.item_id
                     )
              from public.inventory i
                    join public.item m on m.id = i.item_id
              where i.character_id = c.id and i.quantity > 0
             ), '[]'::jsonb) inventory
   from public.game_character c
   where c.id = $2 and c.is_active
     and exists(
    select 1
    from public.auth_user owner
    where owner.character_id = c.id and owner.is_active
   )
     and exists(
    select 1
    from public.auth_user u
          join public.game_character own on own.id = u.character_id
    where u.id = $1 and u.is_active and own.is_active
   )
  `, [userId, id]);

  if (!result.rowCount) {
   fail('CHARACTER_NOT_FOUND', '조회할 수 있는 캐릭터가 없습니다.', 404);
  }

  const {inventory, ...character} = result.rows[0];
  return {character, inventory};
 }

 const visitorColumns = 'c.id::text,c.name,c.hunter_grade,c.has_ability,c.ability_grade,c.status,c.profile_image_url';
 const visible = "c.is_active and exists(select 1 from public.auth_user u where u.character_id=c.id and u.is_active)";

 return {
  getPublicCharacter,

  async listVisitorCharacters(query = '', after = '0') {
   const result = await pool.query(`
                select ${visitorColumns}
                from public.game_character c
                where ${visible}
                    and c.id > $2
                    and strpos(lower(c.name), lower($1)) > 0
                order by c.id
                limit 31
            `, [query, after]);

   return result.rows;
  },

  async getVisitorCharacter(id) {
   const result = await pool.query(`
                select ${visitorColumns}
                from public.game_character c
                where ${visible} and c.id = $1
            `, [id]);

   const row = result.rows[0];
   if (!row) fail('CHARACTER_NOT_FOUND', '공개 캐릭터가 없습니다.', 404);

   return row;
  },

  async previewCare(userId, id, action) {
   if (!['heal', 'revive'].includes(action)) {
    fail('INVALID_CARE_ACTION', '치료 또는 부활을 선택하세요.', 400);
   }

   const own = (await pool.query(
       'select character_id from public.auth_user where id=$1 and is_active',
       [userId]
   )).rows[0];

   if (!own?.character_id) {
    fail('CHARACTER_NOT_FOUND', '연결된 캐릭터가 없습니다.', 404);
   }

   const {character: provider} = await getPublicCharacter(userId, String(own.character_id));
   const {character: target} = await getPublicCharacter(userId, id);
   const revive = action === 'revive';

   const settings = await readNumberSettings(
       pool,
       revive
           ? {
            revive_blood_cost: resourceNumber,
            revive_hp: positiveResourceNumber,
            revive_blood: positiveResourceNumber
           }
           : {
            heal_blood_cost: resourceNumber,
            heal_hp_recovery: resourceNumber
           }
   );

   const plan = planCare(revive ? 'REVIVE' : 'HEAL', provider, target, settings);

   if (provider.in_active_battle || target.in_active_battle) {
    fail('BATTLE_ACTIVE', '전투 중에는 치료·부활할 수 없습니다.');
   }

   return {
    action,
    provider,
    target,
    cost: plan.cost,
    hpRecovery: revive ? null : settings.heal_hp_recovery,
    expected: {
     providerBlood: provider.blood - plan.cost,
     targetHp: revive ? settings.revive_hp : Math.min(target.max_hp, target.hp + settings.heal_hp_recovery),
     targetBlood: revive ? settings.revive_blood : (provider.id === target.id ? provider.blood - plan.cost : target.blood),
     targetAp: target.ap
    }
   };
  },

  async transferCoins(userId, id, body) {
   validateCoinTransfer(id, body);

   return actionTransaction(pool, async c => {
    await rejectActionDuplicate(c, body.requestKey);

    const {provider, target} = await lockCharacterPairByUser(c, userId, id);
    await rejectActionDuplicate(c, body.requestKey);

    requireActionCharacter(provider, {allowNearDeath: true});
    requireActionCharacter(target, {allowNearDeath: true});

    if (String(provider.id) === String(target.id)) {
     fail('SELF_TRANSFER', '자신에게 양도할 수 없습니다.');
    }

    // Same character -> battle order as item transfer and donation.
    for (const row of [provider, target].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1)) {
     await requireNoActiveBattle(c, row);
    }

    const amount = body.quantity;

    if (provider.currency < amount) {
     fail('NOT_ENOUGH_CURRENCY', '보유 코인이 부족합니다.');
    }

    if (Number(target.currency) + amount > 2147483647) {
     fail('CURRENCY_LIMIT_CONFLICT', '받는 캐릭터의 코인 저장 한도를 초과합니다.');
    }

    const from = await changeCharacterResources(c, provider, {currency: -amount});
    const to = await changeCharacterResources(c, target, {currency: amount});

    const detail = {
     providerId: String(provider.id),
     targetId: String(target.id),
     quantity: amount,
     before: {
      provider: provider.currency,
      target: target.currency
     },
     after: {
      provider: from.currency,
      target: to.currency
     },
     transferRequestKey: body.requestKey
    };

    await writeActionLog(c, {
     characterId: provider.id,
     category: 'CHARACTER',
     actionType: 'COIN_TRANSFER',
     targetType: 'CHARACTER',
     targetId: target.id,
     description: `${target.name}에게 코인 ${amount}개 양도`,
     detail,
     requestKey: body.requestKey
    });

    await writeActionLog(c, {
     characterId: target.id,
     category: 'CHARACTER',
     actionType: 'COIN_RECEIVE',
     targetType: 'CHARACTER',
     targetId: provider.id,
     description: `${provider.name}에게 코인 ${amount}개 수령`,
     detail
    });

    return {
     quantity: amount,
     currency: from.currency,
     target: {
      id: String(target.id),
      name: target.name
     }
    };
   });
  }
 };
}