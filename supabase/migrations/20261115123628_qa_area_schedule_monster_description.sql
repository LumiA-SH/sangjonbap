-- Preserve closed areas: scheduling requires explicit administrator opt-in.
alter table public.area add column if not exists auto_unlock boolean not null default false;
alter table public.area add constraint area_auto_unlock_requires_time check (not auto_unlock or unlock_at is not null);
alter table public.monster_action add column if not exists description text;
alter table public.monster_action add constraint monster_action_description_length check (description is null or length(description)<=2000);
