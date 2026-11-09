-- Existing values and histories are preserved. No optional combat mechanics.
insert into public.system_config(config_key,config_value) values
('operating_donation', '{"enabled":false,"cost":null,"recovery":null,"minimumRemaining":null,"maximum":null,"dailyLimitEnabled":false,"dailyLimit":null}'::jsonb),
('operating_announcements', '{"events":{"death":{"enabled":false,"template":"","visibility":null,"deduplicate":true,"retryEnabled":false,"maxAttempts":null,"retryMinutes":null,"thresholds":[]},"revive":{"enabled":false,"template":"","visibility":null,"deduplicate":true,"retryEnabled":false,"maxAttempts":null,"retryMinutes":null,"thresholds":[]},"area_unlock":{"enabled":false,"template":"","visibility":null,"deduplicate":true,"retryEnabled":false,"maxAttempts":null,"retryMinutes":null,"thresholds":[]},"monster_discovery":{"enabled":false,"template":"","visibility":null,"deduplicate":true,"retryEnabled":false,"maxAttempts":null,"retryMinutes":null,"thresholds":[]},"clue_discovery":{"enabled":false,"template":"","visibility":null,"deduplicate":true,"retryEnabled":false,"maxAttempts":null,"retryMinutes":null,"thresholds":[]},"investigation_progress":{"enabled":false,"template":"","visibility":null,"deduplicate":true,"retryEnabled":false,"maxAttempts":null,"retryMinutes":null,"thresholds":[]},"story":{"enabled":false,"template":"","visibility":null,"deduplicate":true,"retryEnabled":false,"maxAttempts":null,"retryMinutes":null,"thresholds":[]},"raid":{"enabled":false,"template":"","visibility":null,"deduplicate":true,"retryEnabled":false,"maxAttempts":null,"retryMinutes":null,"thresholds":[]}}}'::jsonb),
('operating_homepage', '{"enabled":false,"accountId":null,"noticeTag":null,"eventTag":null,"limit":null,"publicOnly":true,"excludeReplies":true,"excludeBoosts":true}'::jsonb),
('operating_recovery', '{"recipe":"HOLD","gacha":"HOLD","battle":"HOLD"}'::jsonb)
on conflict(config_key) do nothing;

-- NULL retains legacy period behaviour until an administrator explicitly chooses.
alter table public.gacha add column period_enabled boolean;
alter table public.gacha add column start_inclusive boolean;
alter table public.gacha add column end_inclusive boolean;
alter table public.gacha add constraint gacha_period_settings check (
 period_enabled is not true or (start_at is not null and end_at is not null
 and start_inclusive is not null and end_inclusive is not null and end_at>start_at));
create index idx_donation_day on public.action_log(character_id,(detail->>'dailyTransactionDay')) where action_type='DIRECT_DONATION';
