insert into public.system_config(config_key,config_value) values
('operating_anemia','{"enabled":false,"stages":[]}'::jsonb)
on conflict(config_key) do nothing;
