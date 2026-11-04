-- PREPARED ONLY. Requires separate user approval and a verified backup.
-- Run with psql -X --single-transaction --set=ON_ERROR_STOP=1 --file=... .
-- Do not run individual statements or use an auto-commit SQL editor.
\set ON_ERROR_STOP on
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(20261104, 5);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN
    ('20261101032815','20261101091456','20261101142433','20261102230733','20261103103806')) THEN
    RAISE EXCEPTION 'One or more target migrations already recorded; review before applying';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.idx_character_recipe_recipe')
    AND indisvalid AND indisready AND NOT indisunique AND indpred IS NULL
    AND pg_get_indexdef(indexrelid)='CREATE INDEX idx_character_recipe_recipe ON public.character_recipe USING btree (recipe_id)') THEN
    RAISE EXCEPTION 'Existing recipe index differs from reviewed definition';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gacha_reward GROUP BY gacha_id,item_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate gacha rewards require operator review';
  END IF;
END $$;
\ir ../../supabase/migrations/20261101032815_common_rules_v02.sql
\ir ../../supabase/migrations/20261101091456_recipe_first_discovery.sql
\ir ../../supabase/migrations/20261101142433_investigation_batch_cooking_v02.sql
\ir ../../supabase/migrations/20261102230733_admin_operations_phase_two.sql
\ir ../../supabase/migrations/20261103103806_gacha_rp_stock.sql
-- History is committed with the DDL, never marked applied before it succeeds.
-- statements is nullable in the inspected history schema; retain original files and hashes.
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES
 ('20261101032815','common_rules_v02'),
 ('20261101091456','recipe_first_discovery'),
 ('20261101142433','investigation_batch_cooking_v02'),
 ('20261102230733','admin_operations_phase_two'),
 ('20261103103806','gacha_rp_stock');
