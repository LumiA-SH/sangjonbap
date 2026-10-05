// All values are bound parameters. Ownership comes from the authenticated user.
export function createPostgresRepository(pool) {
  return {
    async getUser(id) {
      const r = await pool.query(
          'select id, character_id, role, is_active from public.auth_user where id=$1',
          [id]
      );
      return r.rows[0] || null;
    },

    async getCharacter(id) {
      const r = await pool.query(
          `select c.*
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

        const own = await client.query(
            `select c.id
             from public.game_character c
                    join public.auth_user u on u.character_id=c.id
             where u.id=$1 and u.is_active and c.is_active
               for update of u,c`,
            [id]
        );

        if (!own.rowCount) {
          await client.query('rollback');
          return null;
        }

        const r = await client.query(
            'update public.game_character set name=$1 where id=$2 returning *',
            [patch.name, own.rows[0].id]
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

        const own = await client.query(
            `select c.*
             from public.game_character c
                    join public.auth_user u on u.character_id=c.id
             where u.id=$1 and u.is_active and c.is_active
               for update of u,c`,
            [userId]
        );

        if (!own.rowCount) {
          await client.query('rollback');
          return null;
        }

        const before = own.rows[0];

        const hp = Math.max(0, Math.min(Number(before.max_hp), Number(before.hp) + changes.hp));
        const blood = Math.max(0, Math.min(Number(before.max_blood), Number(before.blood) + changes.blood));
        const ap = Math.max(0, Math.min(Number(before.max_ap), Number(before.ap) + changes.ap));
        const currency = Math.max(0, Number(before.currency) + changes.currency);

        let status = before.status;
        let deathCount = Number(before.death_count);

        if (hp === 0 && before.status !== 'DEAD') {
          status = 'DEAD';
          deathCount += 1;
        } else if (status !== 'DEAD' && blood === 0) {
          status = 'NEAR_DEATH';
        }

        const r = await client.query(
            `update public.game_character
           set hp=$1, blood=$2, ap=$3, currency=$4, status=$5, death_count=$6
           where id=$7
           returning *`,
            [hp, blood, ap, currency, status, deathCount, before.id]
        );

        const character = r.rows[0];

        await client.query(
            `insert into public.action_log
               (character_id, category, action_type, description, detail)
             values ($1,$2,$3,$4,$5::jsonb)`,
            [
              before.id,
              'CHARACTER',
              'RESOURCE_CHANGE',
              reason,
              JSON.stringify({
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
              })
            ]
        );

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