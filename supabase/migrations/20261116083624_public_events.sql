-- Independent administrator-managed events; existing notices and RLS remain unchanged.
insert into public.system_config(config_key,config_value)
values ('public_events','{"nextId":1,"items":[]}'::jsonb)
on conflict(config_key) do nothing;
