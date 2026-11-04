-- Local draft only. Do not apply to the shared/production database during development.
-- A pre-existing duplicate (gacha_id,item_id) intentionally aborts this migration;
-- operators must resolve it without silently dropping historical data.
alter table public.gacha_reward add column is_active boolean not null default true;
create unique index uq_gacha_reward_item on public.gacha_reward(gacha_id,item_id);
alter table public.gacha alter column price set default 1;
alter table public.recipe alter column success_rate set default 80;
alter table public.recipe alter column result_quantity set default 3;
