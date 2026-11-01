-- v0.2 common rules. Apply only after reviewing the deployment report.
-- No existing characters, inventories, battles, logs or reset start dates are changed.
alter table public.game_character alter column blood set default 100,
    alter column max_blood set default 100;
alter table public.gacha alter column price set default 1;

insert into public.system_config(config_key,config_value) values
    ('revive_blood','50'::jsonb),
    ('training_great_rate_a','20'::jsonb),
    ('training_great_rate_s','15'::jsonb)
on conflict(config_key) do update set config_value=excluded.config_value;

-- Existing master prices/effects are not overwritten. Use ADMIN to review them.
-- Legacy blood > 100 requires a separate approved conversion, never an implicit clamp.
