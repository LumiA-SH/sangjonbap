alter table public.shop_product add column stock_limit integer check (stock_limit is null or stock_limit >= 0);
comment on column public.shop_product.purchase_limit is 'Per-character lifetime quantity limit; NULL is unlimited.';
comment on column public.shop_product.stock_limit is 'Global lifetime quantity limit; NULL is unlimited. Remaining = limit - purchases.';
create table public.shop_purchase (
 id bigint generated always as identity primary key,
 product_id bigint not null references public.shop_product(id),
 character_id bigint not null references public.game_character(id),
 quantity integer not null check (quantity > 0),
 unit_price integer not null check (unit_price >= 0),
 total_price bigint not null check (total_price = quantity::bigint * unit_price),
 request_key uuid not null unique,
 created_at timestamptz not null default now()
);
create index shop_purchase_product_character_idx on public.shop_purchase(product_id,character_id);
create index shop_purchase_character_idx on public.shop_purchase(character_id);
alter table public.shop_purchase enable row level security;
revoke all on public.shop_purchase from anon, authenticated;
