-- PREPARATION ONLY. Apply only after separate production approval.
-- No extensions, Vault secrets or Cron jobs are created by this file.
BEGIN;
CREATE SCHEMA maintenance_control;
REVOKE ALL ON SCHEMA maintenance_control FROM PUBLIC, anon, authenticated;
CREATE TABLE maintenance_control.settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false
);
INSERT INTO maintenance_control.settings(singleton) VALUES(true);
CREATE TABLE maintenance_control.battle_expiry_retry (
 battle_id bigint PRIMARY KEY,
 last_attempt_at timestamptz NOT NULL,
 next_attempt_at timestamptz NOT NULL,
 last_error_code varchar(64) NOT NULL
);
CREATE TABLE maintenance_control.http_run (
 request_id bigint PRIMARY KEY,
 job text NOT NULL CHECK(job IN ('daily-reset','battle-expiry')),
 queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 checked_at timestamptz,
 outcome text NOT NULL DEFAULT 'PENDING' CHECK(outcome IN ('PENDING','OK','FAILED','HOLD','TIMEOUT')),
 http_status integer,
 error_code varchar(64)
);
CREATE INDEX http_run_pending ON maintenance_control.http_run(queued_at) WHERE outcome='PENDING';
ALTER TABLE maintenance_control.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_control.battle_expiry_retry ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_control.http_run ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA maintenance_control FROM PUBLIC,anon,authenticated;

CREATE FUNCTION maintenance_control.enqueue(job text) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $function$
DECLARE token text; token_count integer; request bigint; start_day date; completed_day date;
BEGIN
 IF job NOT IN ('daily-reset','battle-expiry') OR job IS NULL THEN RAISE EXCEPTION 'Invalid maintenance job'; END IF;
 IF (SELECT enabled FROM maintenance_control.settings WHERE singleton) IS DISTINCT FROM true THEN RETURN NULL; END IF;
 SELECT start_date,last_completed_date INTO start_day,completed_day FROM public.daily_reset_state WHERE singleton;
 IF start_day IS NULL OR start_day > (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date THEN RETURN NULL; END IF;
 IF job='daily-reset' AND completed_day >= (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date THEN RETURN NULL; END IF;
 -- Short transaction lock prevents overlapping Cron ticks from queuing duplicate HTTP calls.
 IF NOT pg_try_advisory_xact_lock(20261108,CASE WHEN job='daily-reset' THEN 1 ELSE 2 END) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM maintenance_control.http_run r WHERE r.job=enqueue.job AND r.outcome='PENDING'
   AND r.queued_at>clock_timestamp()-interval '150 seconds') THEN RETURN NULL; END IF;
 -- pg_net queues decrypted headers. Refuse to enqueue if browser DB roles can read them.
 IF has_table_privilege('anon','net.http_request_queue','SELECT')
   OR has_table_privilege('authenticated','net.http_request_queue','SELECT')
   OR has_table_privilege('anon','vault.decrypted_secrets','SELECT')
   OR has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') THEN
   RAISE EXCEPTION 'Maintenance secret storage permissions require review';
 END IF;
 SELECT count(*),min(decrypted_secret) INTO token_count,token FROM vault.decrypted_secrets WHERE name='maintenance_secret';
 IF token_count<>1 OR token IS NULL OR length(token)<32 THEN RAISE EXCEPTION 'Maintenance Vault secret unavailable'; END IF;
 request:=net.http_post(
   url:='https://grkohfxvafbquhmgnvwj.supabase.co/functions/v1/maintenance/'||job,
   headers:=jsonb_build_object('Content-Type','application/json','x-maintenance-secret',token),
   body:='{}'::jsonb,timeout_milliseconds:=120000);
 INSERT INTO maintenance_control.http_run(request_id,job) VALUES(request,job);
 RETURN request;
END $function$;
REVOKE ALL ON FUNCTION maintenance_control.enqueue(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION maintenance_control.refresh_results() RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $function$
DECLARE run record; response record; payload jsonb; outcome_value text; code_value text; updated integer:=0;
BEGIN
 FOR run IN SELECT * FROM maintenance_control.http_run WHERE outcome='PENDING' ORDER BY queued_at LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
  SELECT status_code,timed_out,content INTO response FROM net._http_response WHERE id=run.request_id;
  IF NOT FOUND THEN
   IF run.queued_at>clock_timestamp()-interval '150 seconds' THEN CONTINUE; END IF;
   outcome_value:='TIMEOUT';code_value:='HTTP_RESPONSE_MISSING';
  ELSE
   payload:=NULL;
   BEGIN payload:=response.content::jsonb; EXCEPTION WHEN invalid_text_representation THEN payload:=NULL; END;
   code_value:=payload->'error'->>'code';
   IF code_value IS NOT NULL AND code_value !~ '^[A-Z0-9_]{1,64}$' THEN code_value:='HTTP_ERROR'; END IF;
   IF response.timed_out THEN outcome_value:='TIMEOUT';code_value:='HTTP_TIMEOUT';
   ELSIF response.status_code BETWEEN 200 AND 299 AND payload->'ok'='true'::jsonb
     AND payload#>>'{data,reset,hold}' IS NULL THEN outcome_value:='OK';code_value:=NULL;
   ELSIF code_value LIKE '%HOLD' THEN outcome_value:='HOLD';
   ELSE outcome_value:='FAILED';code_value:=coalesce(code_value,'HTTP_RESPONSE_FAILED');END IF;
  END IF;
  UPDATE maintenance_control.http_run SET outcome=outcome_value,error_code=code_value,
    http_status=response.status_code,checked_at=clock_timestamp() WHERE request_id=run.request_id;
  updated:=updated+1;
 END LOOP;
 -- Retain only maintenance HTTP results for 30 days; never touch game audit logs.
 DELETE FROM maintenance_control.http_run WHERE request_id IN (
   SELECT request_id FROM maintenance_control.http_run
   WHERE outcome<>'PENDING' AND checked_at<clock_timestamp()-interval '30 days'
   ORDER BY checked_at LIMIT 1000 FOR UPDATE SKIP LOCKED
 );
 RETURN updated;
END $function$;
REVOKE ALL ON FUNCTION maintenance_control.refresh_results() FROM PUBLIC,anon,authenticated;
COMMIT;
