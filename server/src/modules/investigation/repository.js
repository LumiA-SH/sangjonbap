import {AppError} from '../../shared/http.js';
import {lockCharacterByUser, changeCharacterResources, changeInventoryQuantity, writeActionLog} from '../../shared/game.js';
import {chooseResult, winsReward, randomUnit} from './random.js';

function duplicateRequest() {
  return new AppError(409, 'DUPLICATE_REQUEST', '이미 처리된 요청입니다.');
}

function requireCharacter(character) {
  if (!character) throw new AppError(404, 'CHARACTER_NOT_FOUND', '연결된 활성 캐릭터가 없습니다.');
  if (character.status === 'DEAD') throw new AppError(409, 'CHARACTER_DEAD', '사망한 캐릭터는 조사할 수 없습니다.');
}

function areaView(area) {
  return {
    id: area.id, name: area.name, description: area.description, image_url: area.image_url,
    is_open: area.is_open, unlock_at: area.unlock_at, investigation_rate: Number(area.investigation_rate)
  };
}

async function rejectDuplicate(client, requestKey) {
  const existing = await client.query('select id from public.action_log where request_key=$1', [requestKey]);
  if (existing.rowCount) throw duplicateRequest();
}

export function createInvestigationRepository(pool, {random = randomUnit} = {}) {
  return {
    async getInvestigationAreas(userId) {
      // A single statement gives character eligibility and areas one snapshot.
      const r = await pool.query(
        `select c.id as character_id,c.status,
                coalesce((select jsonb_agg(jsonb_build_object(
                  'id',a.id::text,'name',a.name,'description',a.description,'image_url',a.image_url,
                  'is_open',a.is_open,'unlock_at',a.unlock_at,'investigation_rate',a.investigation_rate
                ) order by a.sort_order,a.id)
                from public.area a where a.is_open and (a.unlock_at is null or a.unlock_at<=statement_timestamp())), '[]'::jsonb) as areas
         from public.game_character c join public.auth_user u on u.character_id=c.id
         where u.id=$1 and u.is_active and c.is_active`, [userId]
      );
      requireCharacter(r.rows[0]);
      return r.rows[0].areas;
    },

    async investigate(userId, areaId, requestKey) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await rejectDuplicate(client, requestKey);

        // Every investigation locks area -> character -> items (ascending id).
        // Area serialization protects progress; character locking also protects
        // missing inventory rows against concurrent inventory/storage operations.
        const areaResult = await client.query('select * from public.area where id=$1 for update', [areaId]);
        let area = areaResult.rows[0];
        if (!area) throw new AppError(404, 'AREA_NOT_FOUND', '존재하지 않는 조사 지역입니다.');
        const opened = await client.query(
          'select ($1::boolean and ($2::timestamptz is null or $2::timestamptz<=clock_timestamp())) as accessible',
          [area.is_open, area.unlock_at]
        );
        if (!opened.rows[0].accessible) throw new AppError(409, 'AREA_CLOSED', '아직 조사할 수 없는 지역입니다.');

        const before = await lockCharacterByUser(client, userId);
        // A concurrent retry may have committed while we waited for row locks.
        await rejectDuplicate(client, requestKey);
        requireCharacter(before);
        if (Number(before.ap) < 1) throw new AppError(409, 'NOT_ENOUGH_AP', '조사에 필요한 AP가 부족합니다.');

        const candidates = await client.query(
          `select * from public.investigation_result
           where area_id=$1 and is_active order by id for share`, [areaId]
        );
        const selected = chooseResult(candidates.rows, random);
        if (!selected) throw new AppError(409, 'NO_INVESTIGATION_RESULT', '등록된 조사 결과가 없습니다.');
        const character = await changeCharacterResources(client, before, {ap: -1});

        let firstDiscovery = false;
        const rateBefore = Number(area.investigation_rate);
        if (selected.is_unique) {
          const discovery = await client.query(
            `insert into public.unique_discovery (investigation_result_id,character_id)
             values ($1,$2) on conflict (investigation_result_id) do nothing returning id`,
            [selected.id, before.id]
          );
          firstDiscovery = discovery.rowCount > 0;
          if (firstDiscovery) {
            const progress = await client.query(
              `update public.area set investigation_rate=least(100,investigation_rate+$1::numeric)
               where id=$2 returning *`, [selected.investigation_rate_value, areaId]
            );
            area = progress.rows[0];
          }
        }

        const rewardRows = await client.query(
          `select * from public.investigation_reward
           where investigation_result_id=$1 order by item_id,id for share`, [selected.id]
        );
        const rewards = [];
        for (const reward of rewardRows.rows) {
          if (!winsReward(reward.probability, random)) continue;
          const itemResult = await client.query(
            'select id,name,is_active from public.item where id=$1 for update', [reward.item_id]
          );
          const item = itemResult.rows[0];
          if (!item?.is_active) throw new AppError(409, 'REWARD_UNAVAILABLE', '지급할 수 없는 보상이 설정되어 있습니다.');
          const inventory = await changeInventoryQuantity(client, before.id, reward.item_id, reward.quantity);
          if (!inventory.ok) throw new Error('Inventory reward failed');
          rewards.push({rewardId: reward.id, itemId: item.id, name: item.name,
            quantity: reward.quantity, inventoryQuantity: inventory.after});
        }

        let clue = null;
        if (selected.clue_id !== null) {
          const clueResult = await client.query('select * from public.clue where id=$1', [selected.clue_id]);
          clue = clueResult.rows[0] || null;
        }
        const result = {
          result: {id: selected.id, result_grade: selected.result_grade, result_text: selected.result_text,
            is_unique: selected.is_unique, investigation_rate_value: Number(selected.investigation_rate_value)},
          rewards, clue, firstDiscovery, area: areaView(area), ap: Number(character.ap)
        };
        await writeActionLog(client, {
          characterId: before.id, category: 'INVESTIGATION', actionType: 'INVESTIGATE',
          targetType: 'AREA', targetId: areaId, description: selected.result_text,
          detail: {area_id: areaId, result_id: selected.id, rewards, clue_id: selected.clue_id,
            first_discovery: firstDiscovery, investigation_rate_before: rateBefore,
            investigation_rate_after: Number(area.investigation_rate), ap_before: Number(before.ap), ap_after: result.ap},
          requestKey
        });
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback');
        if (err?.code === '23505' && err?.constraint === 'action_log_request_key_key') throw duplicateRequest();
        throw err;
      } finally {
        client.release();
      }
    }
  };
}
