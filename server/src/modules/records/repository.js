const account = `exists (select 1 from public.auth_user u join public.game_character own on own.id=u.character_id
    where u.id=$1 and u.is_active and own.is_active)`;
const logColumns = `l.id,l.created_at,l.character_id,c.name as character_name,l.category,l.action_type,
    l.target_type,l.target_id,l.description,l.detail,l.request_key`;
const logCursor = `($2::bigint is null or (l.created_at,l.id)<
    (select created_at,id from public.action_log where id=$2))`;

const adminLogSearch = `($4::text='' or strpos(lower(concat_ws(' ',c.name,ac.name,l.action_type,l.description,l.detail::text,to_char(l.created_at at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS'))),lower($4))>0)`;

export function playerActionRecord(row) {
    if (row.category !== 'GACHA' && row.action_type !== 'GACHA_DRAW') return row;
    // Historical logs may predate v0.2 and still contain reward weights or candidate lists.
    // Keep the stored audit intact; expose only the same outcome fields as today's draw API.
    const detail = row.detail || {};
    const visible = Object.fromEntries(['gachaId','price','currencyBefore','currency','inventoryBefore','inventoryQuantity']
        .filter(key => Object.hasOwn(detail,key)).map(key => [key,detail[key]]));
    if (detail.reward) visible.reward = Object.fromEntries(['id','itemId','name','quantity']
        .filter(key => Object.hasOwn(detail.reward,key)).map(key => [key,detail.reward[key]]));
    return {...row,detail:visible};
}

export function createRecordsRepository(pool) {
    return {
        async getActionRecords(userId, before = null, investigationsOnly = false, requestKey = null) {
            const result = await pool.query(`select ${logColumns} from public.action_log l
                join public.game_character c on c.id=l.character_id
                join public.auth_user u on u.character_id=c.id
                where u.id=$1 and u.is_active and c.is_active and ${logCursor}
                  and ($3::boolean=false or l.action_type='INVESTIGATE')
                  ${requestKey===null?'':'and l.request_key=$4::uuid'}
                order by l.created_at desc,l.id desc limit 31`, requestKey===null?[userId,before,investigationsOnly]:[userId,before,investigationsOnly,requestKey]);
            return result.rows.map(playerActionRecord);
        },
        async getAdminActionRecords(userId, before = null, category = null, query = '') {
            const result = await pool.query(`select ${logColumns},l.admin_user_id,ac.name as admin_name from public.action_log l
                left join public.game_character c on c.id=l.character_id
                left join public.auth_user au on au.id=l.admin_user_id
                left join public.game_character ac on ac.id=au.character_id
                where exists (select 1 from public.auth_user where id=$1 and is_active and role='ADMIN')
                  and ($3::text is null or l.category=$3) and ${adminLogSearch}
                  and ${logCursor} order by l.created_at desc,l.id desc limit 31`, [userId, before, category, query]);
            return result.rows;
        },
        async getAdminLogCategories(userId, query = '') {
            return (await pool.query(`select l.category,count(*)::text as count from public.action_log l
                left join public.game_character c on c.id=l.character_id
                left join public.auth_user au on au.id=l.admin_user_id
                left join public.game_character ac on ac.id=au.character_id
                where exists(select 1 from public.auth_user where id=$1 and is_active and role='ADMIN')
                and ${adminLogSearch.replaceAll('$4','$2')}
                group by l.category order by l.category`,[userId,query])).rows;
        },
        async getDiscoveryRecords(userId, before = null) {
            const result = await pool.query(`select d.id,d.discovered_at,r.result_text,a.id as area_id,a.name as area_name,
                d.character_id,c.name as character_name from public.unique_discovery d
                join public.investigation_result r on r.id=d.investigation_result_id
                join public.area a on a.id=r.area_id
                left join public.game_character c on c.id=d.character_id
                where ${account} and ($2::bigint is null or d.id<$2) order by d.id desc limit 31`, [userId, before]);
            return result.rows;
        },
        async getClueRecords(userId, before = null) {
            const result = await pool.query(`select cl.id,cl.title,cl.content,cl.related_target,cl.discovered_at,cl.is_discovered,cl.manually_published,
                cl.first_discoverer_id as character_id,c.name as character_name,a.id as area_id,a.name as area_name
                from public.clue cl left join public.area a on a.id=cl.area_id
                left join public.game_character c on c.id=cl.first_discoverer_id
                where ${account} and (cl.is_discovered=true or cl.manually_published=true) and cl.is_public=true and ($2::bigint is null or cl.id<$2)
                order by cl.id desc limit 31`, [userId, before]);
            return result.rows;
        }
    };
}
