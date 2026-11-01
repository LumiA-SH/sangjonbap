-- Defaults for NEW records only. Existing areas, recipes and food settings are preserved.
-- Runtime cooking applies v0.2 80% / 3 outputs independently of legacy recipe values.
alter table public.area alter column encounter_rate set default 40;
alter table public.recipe alter column success_rate set default 80;
alter table public.recipe alter column result_quantity set default 3;
