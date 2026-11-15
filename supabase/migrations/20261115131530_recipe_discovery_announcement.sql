-- Add only the future recipe event; retain every existing policy and queued post.
update public.system_config
set config_value=jsonb_set(config_value,'{events,recipe_discovery}',
    coalesce(config_value#>'{events,monster_discovery}',
        '{"enabled":false,"visibility":null,"deduplicate":true,"retryEnabled":false,"maxAttempts":null,"retryMinutes":null,"thresholds":[]}'::jsonb)
    || '{"template":"{character} · 「{recipe}」 레시피 최초 발견","deduplicate":true,"thresholds":[]}'::jsonb)
where config_key='operating_announcements'
  and jsonb_typeof(config_value->'events')='object'
  and not (config_value->'events' ? 'recipe_discovery');
