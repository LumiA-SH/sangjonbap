-- Approved minimal retry dependency; no extensions, jobs, secrets or game writes.
BEGIN;
CREATE SCHEMA maintenance_control;
REVOKE ALL ON SCHEMA maintenance_control FROM PUBLIC,anon,authenticated;
CREATE TABLE maintenance_control.battle_expiry_retry (
 battle_id bigint PRIMARY KEY,
 last_attempt_at timestamptz NOT NULL,
 next_attempt_at timestamptz NOT NULL,
 last_error_code varchar(64) NOT NULL
);
ALTER TABLE maintenance_control.battle_expiry_retry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON maintenance_control.battle_expiry_retry FROM PUBLIC,anon,authenticated;
COMMIT;
