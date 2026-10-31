insert into public.system_config(config_key,config_value,description)
values ('daily_blood_decay','10'::jsonb,'일일 혈량 차감량; 소급 적용 정책은 별도 확정 필요')
on conflict (config_key) do nothing;

create table public.daily_reset_state (
 singleton boolean primary key default true check (singleton),
 start_date date,
 last_completed_date date,
 check (last_completed_date is null or (start_date is not null and last_completed_date >= start_date))
);
insert into public.daily_reset_state(singleton) values (true);

create table public.daily_reset_run (
 reset_date date primary key,
 completed_at timestamptz not null default clock_timestamp(),
 detail jsonb not null check (jsonb_typeof(detail) = 'object')
);
alter table public.daily_reset_state enable row level security;
alter table public.daily_reset_run enable row level security;
revoke all on public.daily_reset_state, public.daily_reset_run from anon, authenticated;
