// All values are bound parameters. Ownership comes from the authenticated user.
export function createPostgresRepository(pool) {
  return {
    async getUser(id) {const r=await pool.query('select id, character_id, role, is_active from public.auth_user where id=$1',[id]);return r.rows[0]||null;},
    async getCharacter(id) {const r=await pool.query('select c.* from public.game_character c join public.auth_user u on u.character_id=c.id where u.id=$1 and u.is_active and c.is_active',[id]);return r.rows[0]||null;},
    async updateProfile(id,patch) {
      const client=await pool.connect();
      try {
        await client.query('begin');
        const own=await client.query('select c.id from public.game_character c join public.auth_user u on u.character_id=c.id where u.id=$1 and u.is_active and c.is_active for update of u,c',[id]);
        if(!own.rowCount){await client.query('rollback');return null;}
        const r=await client.query('update public.game_character set name=$1 where id=$2 returning *',[patch.name,own.rows[0].id]);
        await client.query('commit');return r.rows[0];
      } catch(err){await client.query('rollback');throw err;} finally{client.release();}
    },
    async check(){const r=await pool.query("select to_regclass('public.auth_user')::text as auth_user, to_regclass('public.game_character')::text as game_character");if(!r.rows[0].auth_user||!r.rows[0].game_character)throw new Error('Core tables missing');await pool.query('select u.id,u.character_id,u.role,u.is_active,c.name,c.hp,c.ap from public.auth_user u left join public.game_character c on c.id=u.character_id limit 0');return {mode:'supabase',coreTables:true};}
  };
}
