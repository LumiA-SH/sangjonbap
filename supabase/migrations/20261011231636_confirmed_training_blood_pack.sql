-- Existing character resources and master data are not rescaled or reset.
alter table public.game_character add column last_training_date date;
alter table public.shop_product add column daily_limit integer check (daily_limit > 0);
create table public.blood_pack_purchase_day (
    character_id bigint not null references public.game_character(id),
    purchase_date date not null,
    quantity integer not null check (quantity = 1),
    primary key (character_id,purchase_date)
);
alter table public.blood_pack_purchase_day enable row level security;
revoke all on public.blood_pack_purchase_day from anon,authenticated;
insert into public.system_config(config_key,config_value) values
 ('permanent_stat_cap','40'::jsonb)
on conflict(config_key) do update set config_value=excluded.config_value;
insert into public.system_config(config_key,config_value) values
 ('training_ap_cost','0'::jsonb),('training_currency_reward','1'::jsonb),
 ('training_growth','1'::jsonb),('training_great_growth','2'::jsonb),
 ('training_great_rate_b','25'::jsonb),('training_great_rate_a','15'::jsonb),('training_great_rate_s','10'::jsonb)
on conflict(config_key) do nothing;
