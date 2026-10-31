-- Preserve existing characters and battle history. Legacy battles have NULL snapshots.
alter table public.battle add column snapshot jsonb,
    add column declaration jsonb, add column last_command_at timestamptz,
    add column end_reason text;
alter table public.monster_action add column is_active boolean not null default true;
alter table public.monster_drop add column is_ingredient boolean not null default false;
alter table public.item add column battle_usable boolean not null default false;
alter table public.game_character alter column blood set default 200,
    alter column max_blood set default 200;
update public.system_config set config_value='100'::jsonb where config_key='revive_blood';
insert into public.system_config(config_key,config_value) values
    ('battle_ability_e_multiplier','1.2'),('battle_ability_e_ap_cost','1'),
    ('battle_ability_d_multiplier','1.4'),('battle_ability_d_ap_cost','1'),
    ('battle_ability_c_multiplier','1.6'),('battle_ability_c_ap_cost','2'),
    ('battle_ability_b_multiplier','1.8'),('battle_ability_b_ap_cost','2'),
    ('battle_ability_a_multiplier','2.0'),('battle_ability_a_ap_cost','3'),
    ('battle_ability_s_multiplier','2.2'),('battle_ability_s_ap_cost','3')
on conflict(config_key) do nothing;
create index idx_battle_timeout on public.battle((coalesce(last_command_at,started_at)))
    where battle_status='ACTIVE';
