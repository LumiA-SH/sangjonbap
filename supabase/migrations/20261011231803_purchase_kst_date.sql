-- Preserve old rows. New purchases latch the KST business day after character lock.
alter table public.shop_purchase add column purchase_date date;
