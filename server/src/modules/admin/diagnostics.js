// Read-only: never infer history, recover resources or rewrite battle snapshots.
export function createAdminDiagnostics(pool) {
    return {async getAdminDiagnostics() {
        const result=await pool.query(`select
          (select coalesce(jsonb_agg(x),'[]') from (select r.id,r.name,count(cr.character_id) as learned_count from public.recipe r join public.character_recipe cr on cr.recipe_id=r.id where not exists(select 1 from public.recipe_discovery d where d.recipe_id=r.id) group by r.id order by r.id limit 100) x) as recipes,
          (select coalesce(jsonb_agg(x),'[]') from (select id,gacha_id,item_id,max_stock,remaining_stock from public.gacha_reward where max_stock is null or remaining_stock is null order by id limit 100) x) as gachas,
          (select coalesce(jsonb_agg(x),'[]') from (select b.id,b.character_id,b.battle_status,b.character_hp,c.hp,c.blood,c.status,(b.snapshot is null or b.declaration is null) as missing_snapshot from public.battle b join public.game_character c on c.id=b.character_id where b.battle_status='ACTIVE' and (b.snapshot is null or b.declaration is null or b.character_hp<>c.hp or c.status<>'ALIVE' or c.hp<=0 or c.blood<=0) order by b.id limit 100) x) as battles,
          (select coalesce(jsonb_agg(x),'[]') from (select distinct r.failure_item_id as item_id from public.recipe r where exists(select 1 from public.recipe s where s.result_item_id=r.failure_item_id) order by item_id limit 100) x) as "sharedFailureItems"`);
        return {...result.rows[0],limitPerCategory:100,recoveryEnabled:false};
    }};
}
