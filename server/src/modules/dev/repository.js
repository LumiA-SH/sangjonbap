export function createDevRepository(pool) {
    return {
        async getDevActionLogs(userId, requestKey = null) {
            const result = await pool.query(
                `select l.id,l.created_at,l.character_id,c.name as character_name,
                        l.category,l.action_type,l.target_type,l.target_id,l.description,l.detail,l.request_key
                 from public.action_log l
                 join public.game_character c on c.id=l.character_id
                 join public.auth_user u on u.character_id=c.id
                 where u.id=$1 and u.is_active and c.is_active
                   and ($2::uuid is null or l.request_key=$2::uuid)
                 order by l.created_at desc,l.id desc limit 30`, [userId, requestKey]
            );
            return result.rows;
        }
    };
}
