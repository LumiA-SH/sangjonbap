-- Content only; never changes daily_reset_state, Cron or game resources.
insert into public.system_config(config_key,config_value) values
('public_world','{"title":"","body":"","published":false}'::jsonb),
('public_system','{"items":[]}'::jsonb),
('public_schedule','{"title":"","body":"","startAt":null,"endAt":null,"published":false,"items":[]}'::jsonb)
on conflict(config_key) do nothing;
