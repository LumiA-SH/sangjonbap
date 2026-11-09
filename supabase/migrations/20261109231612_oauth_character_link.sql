-- Existing characters remain configured; new OAuth identities have no invented stats.
alter table public.game_character add column initial_setup_complete boolean not null default true;
alter table public.game_character alter column hunter_grade drop not null,
 alter column has_ability drop not null, alter column atk drop not null,
 alter column def drop not null, alter column agi drop not null;
alter table public.game_character add constraint game_character_setup_shape check (
 (initial_setup_complete and hunter_grade is not null and has_ability is not null
  and atk is not null and def is not null and agi is not null)
 or (not initial_setup_complete and hunter_grade is null and has_ability is null
  and ability_grade is null and atk is null and def is null and agi is null));
