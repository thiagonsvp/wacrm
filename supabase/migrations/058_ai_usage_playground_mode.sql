-- ============================================================
-- 058: log the Playground's token spend too.
--
-- The Playground runs the exact same provider call the auto-reply bot
-- does, on the account's own key, but recorded nothing — so tokens it
-- spent were invisible in AI Agents → Usage and unaccounted for against
-- the provider's invoice. Give it its own mode rather than folding it
-- into 'draft': a test chat is not customer-facing work, and mixing the
-- two would misreport what the assistant actually costs in production.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
SET search_path = public, extensions, pg_catalog;

DO $$
DECLARE c record;
BEGIN
  -- Drop whatever CHECK currently constrains `mode`, whatever Postgres
  -- named it (migration 042 recreated it under a known name, but an
  -- older project may still carry the original inline constraint).
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.ai_usage_log'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%mode%auto_reply%'
  LOOP
    EXECUTE format('ALTER TABLE public.ai_usage_log DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_mode_check
    CHECK (mode IN ('auto_reply', 'draft', 'deal_pipeline', 'playground'));
END $$;
