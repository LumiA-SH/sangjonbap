-- Additive only: preserve legacy RP text and the existing visibility of discovered clues.
alter table public.food_config add column rp_effect_texts text[] not null default '{}';
alter table public.food_config add constraint food_rp_candidates_check check (
 cardinality(rp_effect_texts)<=50 and array_position(rp_effect_texts,null) is null
);
alter table public.clue add column is_public boolean not null default true;
