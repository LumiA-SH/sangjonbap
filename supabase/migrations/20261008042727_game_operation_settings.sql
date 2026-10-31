-- Preserve existing operator values, including permanent_stat_cap.
insert into public.system_config(config_key,config_value,description) values
 ('heal_blood_cost','10'::jsonb,'치료 제공자 혈량 비용'),
 ('heal_hp_recovery','20'::jsonb,'치료 HP 회복량'),
 ('revive_blood_cost','30'::jsonb,'부활 제공자 혈량 비용'),
 ('revive_hp','100'::jsonb,'부활 후 HP'),
 ('revive_blood','50'::jsonb,'부활 후 혈량'),
 ('investigation_ap_cost','1'::jsonb,'조사 AP 비용'),
 ('permanent_stat_cap','20'::jsonb,'영구 능력치 성장 상한')
on conflict (config_key) do nothing;

-- Growth services must enforce permanent_stat_cap; keep only nonnegative
-- integrity here. No existing character stats are rewritten.
alter table public.game_character
 drop constraint if exists game_character_atk_cap_check,
 drop constraint if exists game_character_def_cap_check,
 drop constraint if exists game_character_agi_cap_check,
 add constraint game_character_atk_nonnegative_check check (atk >= 0),
 add constraint game_character_def_nonnegative_check check (def >= 0),
 add constraint game_character_agi_nonnegative_check check (agi >= 0);
