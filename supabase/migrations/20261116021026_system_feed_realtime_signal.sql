-- Only an opaque invalidation token is public. Never publish mastodon_event.
create table public.system_feed_signal (
 singleton boolean primary key default true check (singleton),
 revision uuid not null default gen_random_uuid()
);
insert into public.system_feed_signal(singleton) values(true);
alter table public.system_feed_signal enable row level security;
revoke all on public.system_feed_signal from public, anon, authenticated;
grant select on public.system_feed_signal to anon, authenticated;
create policy system_feed_signal_read on public.system_feed_signal for select to anon, authenticated using (singleton);

create function public.notify_system_feed_change() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 update public.system_feed_signal set revision=gen_random_uuid() where singleton;
 return new;
end;
$$;
revoke all on function public.notify_system_feed_change() from public, anon, authenticated;
create trigger mastodon_sent_feed_signal after update of status,remote_status_id on public.mastodon_event
 for each row when (new.status='SENT' and new.remote_status_id is not null and
 (old.status is distinct from new.status or old.remote_status_id is distinct from new.remote_status_id))
 execute function public.notify_system_feed_change();
create trigger homepage_feed_signal after update of config_value on public.system_config
 for each row when (new.config_key='operating_homepage' and old.config_value is distinct from new.config_value)
 execute function public.notify_system_feed_change();

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.system_feed_signal;
 end if;
end $$;
