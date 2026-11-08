-- PREVIEW ONLY: returns proposed commands; DOES NOT register or activate jobs.
-- Approval prerequisites: execution HOLD release, start date, cadence, Vault setup.
-- Vault entry maintenance_secret must match Edge MAINTENANCE_SECRET.
-- Suggested expiry cadence (not approved policy): every 5 minutes, max 10 per call.
-- Run approved registration in one transaction and keep jobs inactive until activation approval.
SELECT job_name, schedule, format(
$draft$SELECT cron.schedule(%L, %L, %L);
SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = %L), active := false);$draft$,
job_name, schedule,
format($command$SELECT net.http_post(
 url := %L,
 headers := jsonb_build_object('Content-Type','application/json','x-maintenance-secret',
   (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'maintenance_secret')),
 body := '{}'::jsonb,
 timeout_milliseconds := 120000
);$command$, 'https://grkohfxvafbquhmgnvwj.supabase.co/functions/v1/maintenance/' || endpoint),
job_name) AS proposed_sql
FROM (VALUES
 ('sangjonbap-daily-reset','0 15 * * *','daily-reset'),
 ('sangjonbap-battle-expiry','*/5 * * * *','battle-expiry')
) AS jobs(job_name,schedule,endpoint);
-- Inspect cron.job_run_details AND net._http_response: HTTP 503 is not necessarily
-- a pg_cron SQL failure. Never log request headers or Vault decrypted values.
-- Expiry retries on next scheduled call. Daily failure needs an approved retry
-- invocation/monitoring; the next midnight alone can delay recovery by a day.
