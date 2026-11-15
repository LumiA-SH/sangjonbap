-- Preserve legacy 1-coin records; current server prices are 2/3/4.
-- No product prices, limits, or game records are updated.
alter table public.shop_product drop constraint recipe_product_policy_check;
alter table public.shop_product add constraint recipe_product_policy_check check (
    recipe_id is null or (price in (1,2,3,4) and purchase_limit is not distinct from 1
        and stock_limit is null and daily_limit is null)
);
