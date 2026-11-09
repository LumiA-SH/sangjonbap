-- PREVIEW ONLY. This SELECT never registers jobs.
-- Requires approved pg_cron/pg_net installation, Vault maintenance_secret and
-- maintenance-control.draft.sql. Create all jobs IN ONE TRANSACTION, inactive.
-- Both maintenance_control.settings.enabled and Edge executionReady stay false.
SELECT job_name,schedule,format(
$draft$SELECT cron.schedule(%L,%L,%L);
SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname=%L),active := false);$draft$,
job_name,schedule,command,job_name) proposed_sql
FROM (VALUES
 ('sangjonbap-daily-reset','0 15 * * *',$cmd$SELECT maintenance_control.enqueue('daily-reset');$cmd$),
 ('sangjonbap-daily-retry','*/5 * * * *',$cmd$SELECT maintenance_control.enqueue('daily-reset');$cmd$),
 ('sangjonbap-battle-expiry','*/5 * * * *',$cmd$SELECT maintenance_control.enqueue('battle-expiry');$cmd$),
 ('sangjonbap-maintenance-monitor','* * * * *',$cmd$SELECT maintenance_control.refresh_results();$cmd$)
) jobs(job_name,schedule,command);
-- Vault is read only inside enqueue; no secret literal is put in cron.job.
-- Review both cron.job_run_details and maintenance_control.http_run.
-- Alert on FAILED/HOLD/TIMEOUT, stale PENDING >150s, or last_completed_date behind KST today.
-- A queued request is NOT proof of a successful Edge invocation.
