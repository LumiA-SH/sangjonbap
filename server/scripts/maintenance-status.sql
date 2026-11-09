-- READ ONLY. Run only after approved infrastructure installation.
-- Do not query Vault values, request headers, or net.http_request_queue contents.
SELECT jobid,jobname,schedule,active FROM cron.job WHERE jobname LIKE 'sangjonbap-%' ORDER BY jobname;
SELECT jobid,runid,status,start_time,end_time FROM cron.job_run_details
 WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'sangjonbap-%')
 ORDER BY start_time DESC LIMIT 50;
SELECT request_id,job,queued_at,checked_at,outcome,http_status,error_code
 FROM maintenance_control.http_run
 WHERE outcome IN ('FAILED','HOLD','TIMEOUT') OR (outcome='PENDING' AND queued_at<clock_timestamp()-interval '150 seconds')
 ORDER BY queued_at DESC LIMIT 100;
SELECT start_date,last_completed_date,(clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date AS today_kst
 FROM public.daily_reset_state;
SELECT count(*) AS retrying_battles,min(r.last_attempt_at) AS oldest_attempt
 FROM maintenance_control.battle_expiry_retry r JOIN public.battle b ON b.id=r.battle_id WHERE b.battle_status='ACTIVE';
-- HOLD requires operator investigation. Never auto-clear start/activity HOLD.
-- Missing daily completion after KST00:05 or repeated failures warrants operator review.
-- Logs accumulate; retention/deletion requires a separate operational decision.
