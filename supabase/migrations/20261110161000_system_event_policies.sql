-- Only add missing policies; never enable posting or replace existing templates.
update public.system_config set config_value=jsonb_set(config_value,'{events}',
  '{"gacha":{"enabled":false,"template":"","visibility":null,"deduplicate":true,"retryEnabled":false,"maxAttempts":null,"retryMinutes":null,"thresholds":[]},
    "failure_food":{"enabled":false,"template":"","visibility":null,"deduplicate":true,"retryEnabled":false,"maxAttempts":null,"retryMinutes":null,"thresholds":[]}}'::jsonb || (config_value->'events'))
where config_key='operating_announcements' and jsonb_typeof(config_value->'events')='object';
