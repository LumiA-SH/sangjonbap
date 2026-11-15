-- Nullable metadata only; existing recipes and their references are preserved.
alter table public.recipe add column if not exists image_url text;
