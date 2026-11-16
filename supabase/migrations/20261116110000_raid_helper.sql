-- 레이드 계산기 전용 보스 HP 상태. 참가자/턴/채팅 관리 테이블은 만들지 않는다.
create table public.raid_boss_state (
    id smallint primary key default 1 check (id = 1),
    max_hp integer not null check (max_hp > 0),
    current_hp integer not null check (current_hp >= 0 and current_hp <= max_hp),
    def integer not null check (def >= 0),
    version integer not null default 0 check (version >= 0),
    updated_at timestamptz not null default now()
);

alter table public.raid_boss_state enable row level security;
revoke all on public.raid_boss_state from anon, authenticated;
-- Express 관리자 API가 서버 DB 연결로만 조회 및 수정한다.
