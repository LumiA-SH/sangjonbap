-- Manual archive publication does not count as discovery or award progress.
alter table public.clue alter column area_id drop not null;
alter table public.clue add column if not exists manually_published boolean not null default false;
