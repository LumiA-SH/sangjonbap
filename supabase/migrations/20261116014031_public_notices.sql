-- Independent notice content; preserves existing settings and game data.
insert into public.system_config(config_key,config_value) values ('public_notice','{"items":[]}'::jsonb) on conflict(config_key) do nothing;
