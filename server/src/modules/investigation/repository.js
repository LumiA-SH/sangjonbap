import {enqueueSystemEvent} from '../mastodon-system/outbox.js';
import {beginGameTransaction, commitGameTransaction, rollbackGameTransaction} from '../../shared/daily-gate.js';
import {AppError} from '../../shared/http.js';
import {requireActionCharacter,requireNoActiveBattle} from '../../shared/actions.js';
import {lockCharacterByUser, changeCharacterResources, changeInventoryQuantity, writeActionLog} from '../../shared/game.js';
import {readNumberSettings, resourceNumber} from '../../shared/settings.js';
import {chooseResult, winsReward, randomUnit} from './random.js';
import {lockAreaRecipeCandidates,discoverAreaRecipe} from '../../shared/recipes.js';
import {getAreaInvestigationProgress} from '../../shared/investigation-progress.js';

function duplicateRequest() {
  return new AppError(409, 'DUPLICATE_REQUEST', '이미 처리된 요청입니다.');
}

function areaView(area, progress) {
  return {
    id: area.id,
    name: area.name,
    description: area.description,
    image_url: area.image_url,
    encounter_rate: Number(area.encounter_rate),
    is_open: area.is_open,
    unlock_at: area.unlock_at,
    investigation_rate: progress.rate
  };
}

async function rejectDuplicate(client, requestKey) {
  const existing = await client.query('select id from public.action_log where request_key=$1', [requestKey]);
  if (existing.rowCount) throw duplicateRequest();
}

export function createInvestigationRepository(pool, {random = randomUnit, battleRepository = null} = {}) {
  return {
    async getInvestigationApCost() {
      const settings = await readNumberSettings(pool, {investigation_ap_cost: resourceNumber});
      return settings.investigation_ap_cost;
    },

    async getInvestigationAreas(userId) {
      const r = await pool.query(
          `select c.id as character_id,c.status,
                  coalesce((select jsonb_agg(jsonb_build_object(
                                                 'id',a.id::text,
                                                 'name',a.name,
                                                 'description',a.description,
                                                 'image_url',a.image_url,
                                                 'encounter_rate',a.encounter_rate,
                                                 'is_open',a.is_open,
                                                 'unlock_at',a.unlock_at,
                                                 'investigation_rate',p.investigation_rate
                                             ) order by a.sort_order,a.id)
                            from public.area a
                                   join public.investigation_progress p on p.area_id=a.id
                            where a.is_open
                              and (a.unlock_at is null or a.unlock_at<=statement_timestamp())),
                           '[]'::jsonb) as areas,

                  (
                    select case
                             when coalesce(sum(global_counts.total_count),0)=0 then 0::numeric
                          else round(
                              100.0*sum(global_counts.discovered_count)/sum(global_counts.total_count),
                              2
                          )
          end
          from (
                          -- 구역별로 고유한 조사 결과는 전체에서도 결과 ID 기준으로 한 번만 계산한다.
                          select count(*) as total_count,
                                 count(ud.investigation_result_id) as discovered_count
                          from public.investigation_result ir
                          left join public.unique_discovery ud on ud.investigation_result_id=ir.id
                          where ir.is_unique and ir.is_active

                          union all

                          -- 하나의 마물이 여러 구역에 잘못 배치되어 있어도 전체에서는 한 번만 계산한다.
                          select count(*) as total_count,
                                 count(m.first_discoverer_id) as discovered_count
                          from public.monster m
                          where m.is_active
                            and exists (
                                select 1 from public.area_monster am
                                where am.monster_id=m.id
                            )

                          union all

                          -- 같은 레시피를 여러 구역의 후보로 등록해도 전체에서는 한 번만 계산한다.
                          select count(*) as total_count,
                                 count(rd.recipe_id) as discovered_count
                          from public.recipe recipe
                          left join public.recipe_discovery rd on rd.recipe_id=recipe.id
                          where recipe.is_active
                            and exists (
                                select 1 from public.area_recipe ar
                                where ar.recipe_id=recipe.id
                            )
                      ) global_counts
                  ) as global_rate

          from public.game_character c
          join public.auth_user u on u.character_id=c.id
          where u.id=$1 and u.is_active and c.is_active`,
          [userId]
      );

      if (!r.rows[0]) {
        throw new AppError(404, 'CHARACTER_NOT_FOUND', '연결된 활성 캐릭터가 없습니다.');
      }

      return {
        areas: r.rows[0].areas,
        globalInvestigationRate: Number(r.rows[0].global_rate)
      };
    },

    async investigate(userId, areaId, requestKey) {
      const client = await pool.connect();

      try {
        await beginGameTransaction(client);
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
        requireActionCharacter(before);
        await requireNoActiveBattle(client,before);

        const {investigation_ap_cost: cost} = await readNumberSettings(client, {investigation_ap_cost: resourceNumber});
        if (Number(before.ap) < cost) throw new AppError(409, 'NOT_ENOUGH_AP', '조사에 필요한 AP가 부족합니다.');

        // 성공·대성공·실패 분류 없이 활성 결과를 가중치로 선택한다.
        const candidates = await client.query(
            `select * from public.investigation_result
             where area_id=$1 and is_active order by id for share`,
            [areaId]
        );

        const selected = chooseResult(candidates.rows, random);
        if (!selected) throw new AppError(409, 'NO_INVESTIGATION_RESULT', '등록된 조사 결과가 없습니다.');

        const character = await changeCharacterResources(client, before, {ap: -cost});

        // Preserve monster -> recipe -> item ordering without rolling encounter yet.
        if (battleRepository) await client.query(
            `select m.id from public.area_monster am
                                join public.monster m on m.id=am.monster_id
             where am.area_id=$1 and m.is_active
             order by m.id for update of m`,
            [area.id]
        );

        const progressBefore = await getAreaInvestigationProgress(client, areaId);
        let firstDiscovery = false;

        if (selected.is_unique) {
          const discovery = await client.query(
              `insert into public.unique_discovery (investigation_result_id,character_id)
               values ($1,$2)
                 on conflict (investigation_result_id) do nothing
               returning id`,
              [selected.id, before.id]
          );

          firstDiscovery = discovery.rowCount > 0;
        }

        const rewardRows = await client.query(
            `select * from public.investigation_reward
             where investigation_result_id=$1 order by item_id,id for share`,
            [selected.id]
        );

        const rewards = [];

        // 구역 공통 레시피 후보를 사용하고 서버 전체 최초 발견을 검증한다.
        const areaRecipeCandidates = await lockAreaRecipeCandidates(client, areaId);
        const discoveredRecipe = await discoverAreaRecipe(
            client, areaRecipeCandidates, before.id, 'INVESTIGATION', selected.id, random
        );

        if (discoveredRecipe) {
          rewards.push(discoveredRecipe);
        }

        // 조사 결과별 일반 아이템 보상은 유지한다.
        // 구형 레시피 지급 경로는 중복 실행하지 않는다.
        for (const reward of rewardRows.rows) {
          if (reward.recipe_id != null) continue;
          if (!winsReward(reward.probability, random)) continue;

          const itemResult = await client.query(
              'select id,name,is_active from public.item where id=$1 for update',
              [reward.item_id]
          );

          const item = itemResult.rows[0];
          if (!item?.is_active) throw new AppError(409, 'REWARD_UNAVAILABLE', '지급할 수 없는 보상이 설정되어 있습니다.');

          const inventory = await changeInventoryQuantity(client, before.id, reward.item_id, reward.quantity);
          if (!inventory.ok) throw new Error('Inventory reward failed');

          rewards.push({
            rewardId: reward.id,
            itemId: item.id,
            name: item.name,
            quantity: reward.quantity,
            inventoryQuantity: inventory.after
          });
        }

        // 조사 보상 처리 후, 별도의 마물 조우 판정을 실행한다.
        const battle = battleRepository ? await battleRepository.encounter(client,area,character) : null;
        let clue = null;

        if (selected.clue_id !== null) {
          // The conditional UPDATE serializes a shared clue's first finder across areas.
          // Publish only after this investigation commits; later discoveries preserve its owner.
          const discovered = await client.query(
              `update public.clue set is_discovered=true,first_discoverer_id=$2,
                                      discovered_at=clock_timestamp()
               where id=$1 and is_discovered=false`,
              [selected.clue_id,before.id]
          );

          const clueResult = await client.query('select * from public.clue where id=$1', [selected.clue_id]);
          clue = clueResult.rows[0]?.is_public===false?null:(clueResult.rows[0] || null);

          if (discovered.rowCount && clue) {
            await enqueueSystemEvent(client,{
              type:'clue_discovery',
              key:String(selected.clue_id),
              characterId:before.id,
              values:{character:before.name,clue:'중요 단서'}
            });
          }
        }

        const progressAfter = await getAreaInvestigationProgress(client, areaId);
        const rateIncrease = Number((progressAfter.rate - progressBefore.rate).toFixed(2));

        const result = {
          result: {
            id: selected.id,
            result_text: selected.result_text,
            is_unique: selected.is_unique,
            investigation_rate_value: rateIncrease
          },
          rewards,
          clue,
          firstDiscovery,
          area: areaView(area, progressAfter),
          ap: Number(character.ap)
        };

        if (battleRepository) result.battle = battle;

        await writeActionLog(client, {
          characterId: before.id,
          category: 'INVESTIGATION',
          actionType: 'INVESTIGATE',
          targetType: 'AREA',
          targetId: areaId,
          description: selected.result_text,
          detail: {
            area_id: areaId,
            result_id: selected.id,
            rewards,
            clue_id: selected.clue_id,
            first_discovery: firstDiscovery,
            investigation_rate_before: progressBefore.rate,
            investigation_rate_after: progressAfter.rate,
            ap_before: Number(before.ap),
            ap_after: result.ap
          },
          requestKey
        });

        await commitGameTransaction(client);
        return result;
      } catch (err) {
        await rollbackGameTransaction(client);
        if (err?.code === '23505' && err?.constraint === 'action_log_request_key_key') throw duplicateRequest();
        throw err;
      } finally {
        client.release();
      }
    }
  };
}