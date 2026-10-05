-- Optional: run manually once in Supabase SQL Editor for development only.
-- No schema/RLS changes. Creates a new pair each time; do not rerun blindly.
-- Demo combat values are placeholders, not confirmed game balance.
begin;
with new_character as (
  insert into public.game_character(name,hunter_grade,atk,def,agi)
  values ('개발 생존자','B',10,10,10)
  returning id
)
insert into public.auth_user(character_id,role)
select id,'USER' from new_character
returning id as dev_auth_user_id,character_id;
commit;
