-- Participation never grants administrator privileges. Existing users default to denied.
alter table public.auth_user add column game_test_enabled boolean not null default false;
