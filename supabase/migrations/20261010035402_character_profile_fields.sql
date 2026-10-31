alter table public.game_character
 add column age text,
 add column job text,
 add column position text check (position is null or position in ('T','M','B')),
 add column profile_url text;
comment on column public.game_character.age is 'Input format/range pending. Nullable raw profile text; editing is on HOLD.';
comment on column public.game_character.profile_url is 'Optional external profile URL; accepted URL format pending. Not profile_image_url.';
