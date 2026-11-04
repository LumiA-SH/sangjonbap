-- Local only: existing learning records do not imply global discovery.
alter table public.recipe add column discovery_grade text
    check (discovery_grade in ('COMMON','RARE','SPECIAL'));

create table public.recipe_discovery (
    recipe_id bigint primary key references public.recipe(id),
    character_id bigint not null references public.game_character(id),
    source_type text not null check (source_type in ('INVESTIGATION','BATTLE')),
    source_id bigint not null,
    discovered_at timestamptz not null default now()
);
create index recipe_discovery_character_idx on public.recipe_discovery(character_id);
-- Reuse existing idx_character_recipe_recipe: btree (recipe_id), valid and non-partial.
alter table public.recipe_discovery enable row level security;
revoke all on public.recipe_discovery from anon, authenticated;

alter table public.investigation_reward alter column item_id drop not null,
    add column recipe_id bigint references public.recipe(id),
    add constraint investigation_reward_target_check check ((item_id is null) <> (recipe_id is null)),
    add constraint investigation_recipe_quantity_check check (recipe_id is null or quantity=1);
create index investigation_reward_recipe_idx on public.investigation_reward(recipe_id) where recipe_id is not null;

alter table public.monster_drop alter column item_id drop not null,
    add column recipe_id bigint references public.recipe(id),
    add constraint monster_drop_target_check check ((item_id is null) <> (recipe_id is null)),
    add constraint monster_recipe_quantity_check check (recipe_id is null or (min_quantity=1 and max_quantity=1 and not is_ingredient));
create index monster_drop_recipe_idx on public.monster_drop(recipe_id) where recipe_id is not null;

alter table public.shop_product alter column item_id drop not null,
    add column recipe_id bigint unique references public.recipe_discovery(recipe_id),
    add constraint shop_product_target_check check ((item_id is null) <> (recipe_id is null)),
    add constraint recipe_product_policy_check check (recipe_id is null or
        (price in (1,2,3) and purchase_limit is not distinct from 1 and stock_limit is null and daily_limit is null));
