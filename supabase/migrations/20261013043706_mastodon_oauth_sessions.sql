-- Identity is scoped to an instance. Preserve every existing account/role/link.
alter table public.auth_user drop constraint auth_user_mastodon_account_id_key;
alter table public.auth_user add constraint auth_user_mastodon_identity_key unique(mastodon_instance,mastodon_account_id);
alter table public.auth_user add column oauth_verified_at timestamptz;

create table public.oauth_login_state (
    state_hash text primary key,
    browser_hash text not null,
    expires_at timestamptz not null
);
create index oauth_login_state_expiry on public.oauth_login_state(expires_at);
create table public.auth_session (
    token_hash text primary key,
    user_id bigint not null references public.auth_user(id) on delete cascade,
    expires_at timestamptz not null
);
create index auth_session_expiry on public.auth_session(expires_at);
create index auth_session_user on public.auth_session(user_id);
alter table public.oauth_login_state enable row level security;
alter table public.auth_session enable row level security;
revoke all on public.oauth_login_state,public.auth_session from anon,authenticated;
