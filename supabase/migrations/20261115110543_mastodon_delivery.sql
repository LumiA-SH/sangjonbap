-- Existing outbox only. No historical messages are automatically released.
alter table public.mastodon_event
  add column delivery_enabled boolean not null default false,
  add column auto_retry boolean not null default false,
  add column max_attempts integer not null default 1 check (max_attempts between 1 and 3),
  add column retry_delay_seconds integer not null default 300 check (retry_delay_seconds between 300 and 604800),
  add column visibility text not null default 'unlisted' check (visibility in ('public','unlisted','private')),
  add column next_attempt_at timestamptz,
  add column attempt_at timestamptz,
  add column lease_token uuid,
  add column lease_until timestamptz,
  add column remote_status_id text;
create index idx_mastodon_delivery on public.mastodon_event(next_attempt_at,id)
  where delivery_enabled and status in ('PENDING','FAILED');
-- Existing RLS, grants, unique dedupe_key and status constraints are preserved.
