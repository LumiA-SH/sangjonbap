import {lockCharacterByUser, changeCharacterResources, writeActionLog} from '../../shared/game.js';
import {requireActionCharacter, requireNoActiveBattle} from '../../shared/actions.js';

// All values are bound parameters. Ownership comes from the authenticated user.
export function createPostgresRepository(pool) {
  return {
    async searchCharacters(query) {
      // Literal substring, not user-supplied SQL wildcard syntax. Return public identifiers only.
      const result = await pool.query(
        `select c.id,c.name from public.game_character c
         where c.is_active and strpos(lower(c.name),lower($1))>0
           and exists(select 1 from public.auth_user u where u.character_id=c.id and u.is_active)
         order by c.name,c.id limit 30`, [query]
      );
      return result.rows;
    },
    async getUser(id) {
      const r = await pool.query(
          'select id, character_id, role, is_active from public.auth_user where id=$1',
          [id]
      );
      return r.rows[0] || null;
    },

    async getCharacter(id) {
      const r = await pool.query(
          `select c.*,exists(select 1 from public.battle b where b.character_id=c.id and b.battle_status='ACTIVE') as in_active_battle,
                  least(c.max_blood,100) as effective_max_blood
           from public.game_character c
                  join public.auth_user u on u.character_id=c.id
           where u.id=$1 and u.is_active and c.is_active`,
          [id]
      );
      return r.rows[0] || null;
    },

    async updateProfile(id, patch) {
      const client = await pool.connect();

      try {
        await client.query('begin');

        const own = await lockCharacterByUser(client, id);

        if (!own) {
          await client.query('rollback');
          return null;
        }

        requireActionCharacter(own,{allowNearDeath:true});
        await requireNoActiveBattle(client,own);
        const r = await client.query(
            'update public.game_character set name=$1 where id=$2 returning *',
            [patch.name, own.id]
        );

        await client.query('commit');
        return r.rows[0];
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    },

    async changeResources(userId, changes, reason) {
      const client = await pool.connect();

      try {
        await client.query('begin');

        const own = await lockCharacterByUser(client, userId);

        if (!own) {
          await client.query('rollback');
          return null;
        }

        requireActionCharacter(own);
        await requireNoActiveBattle(client,own);
        const before = own;
        const character = await changeCharacterResources(client, before, changes);

        await writeActionLog(client, {
          characterId: before.id,
          category: 'CHARACTER',
          actionType: 'RESOURCE_CHANGE',
          description: reason,
          detail: {
            reason,
            requested: {
              hp: changes.hp,
              blood: changes.blood,
              ap: changes.ap,
              currency: changes.currency
            },
            before: {
              hp: Number(before.hp),
              blood: Number(before.blood),
              ap: Number(before.ap),
              currency: Number(before.currency),
              status: before.status,
              death_count: Number(before.death_count)
            },
            after: {
              hp: Number(character.hp),
              blood: Number(character.blood),
              ap: Number(character.ap),
              currency: Number(character.currency),
              status: character.status,
              death_count: Number(character.death_count)
            }
          }
        });

        await client.query('commit');
        return character;
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    },

    async check() {
      const r = await pool.query(
          `select
           to_regclass('public.auth_user')::text as auth_user,
           to_regclass('public.game_character')::text as game_character,
           to_regclass('public.action_log')::text as action_log`
      );

      if (!r.rows[0].auth_user || !r.rows[0].game_character || !r.rows[0].action_log) {
        throw new Error('Core tables missing');
      }

      await pool.query(
          `select u.id,u.character_id,u.role,u.is_active,
                  c.name,c.hp,c.blood,c.ap,c.currency,c.status
           from public.auth_user u
                  left join public.game_character c on c.id=u.character_id
             limit 0`
      );

      return {mode: 'supabase', coreTables: true};
    }
  };
}
