-- Local draft only. Apply after admin_operations_phase_two. No historical stock inference.
alter table public.gacha_reward add column max_stock integer;
alter table public.gacha_reward add column remaining_stock integer;
alter table public.gacha_reward add constraint gacha_reward_stock_bounds check (
    (max_stock is null and remaining_stock is null) or
    (max_stock is not null and remaining_stock is not null and max_stock >= 1
     and remaining_stock >= 0 and remaining_stock <= max_stock)
);
comment on column public.gacha_reward.max_stock is 'Global RP prize capacity. NULL is unresolved legacy migration, never unlimited.';
comment on column public.gacha_reward.remaining_stock is 'Global remaining prizes. Transfers never replenish this value.';
-- weight and quantity remain for compatibility; new draw always charges 1 and grants 1.
