insert into public.system_config(config_key,config_value,description)
values ('cooking_ap_cost','1'::jsonb,'요리 1회 AP 비용') on conflict (config_key) do nothing;
alter table public.recipe alter column result_quantity set default 4;
