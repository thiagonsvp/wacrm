-- ============================================================
-- 042_ai_deal_pipeline.sql — AI-driven sales pipeline (Negócios)
--
-- Reads the WhatsApp thread with the account's BYO LLM key and drives
-- the contact's deal card through the funnel: qualify (with the product
-- model in the title) -> negotiate (with the quoted value) -> won/lost.
--
-- Design notes
--
--   - `ai_configs.deal_pipeline_enabled` is an INDEPENDENT opt-in,
--     exactly like `auto_reply_enabled`. Registering a key so the inbox
--     can draft replies must never start mutating pipeline data as a
--     side effect — moving a deal to "won" is a business-record write,
--     so it stays behind its own switch.
--
--   - `conversations.ai_deal_analyzed_at` is the cooldown clock: at most
--     one classification per conversation per N minutes, so a customer
--     firing off "oi" / "boa tarde" / "tem iPhone?" in a burst costs one
--     provider call, not three. It doubles as the audit trail for "when
--     did the classifier last look at this thread", which the in-memory
--     rate limiter cannot provide (per-instance memory is useless for
--     this on serverless — every cold start would forget the cooldown).
--
--   - `ai_usage_log.mode` gains 'deal_pipeline' so classifier spend is
--     visible next to draft / auto-reply spend on the same key. The
--     original CHECK was created inline and unnamed in 033, so it is
--     located by definition rather than by a guessed name.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS deal_pipeline_enabled boolean NOT NULL DEFAULT false;

-- Cooldown reads are always keyed by the conversation's own id, which the
-- primary key already serves — no additional index required.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_deal_analyzed_at timestamptz;

DO $$
DECLARE
  c record;
BEGIN
  -- Drop whatever CHECK currently constrains `mode`, whatever Postgres
  -- auto-named it, then re-add the widened one. Matching on the
  -- definition (rather than a name) keeps this correct even if the
  -- constraint was created under a different name.
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'ai_usage_log'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%mode%auto_reply%'
  LOOP
    EXECUTE format('ALTER TABLE ai_usage_log DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE ai_usage_log
    ADD CONSTRAINT ai_usage_log_mode_check
    CHECK (mode IN ('auto_reply', 'draft', 'deal_pipeline'));
END $$;
