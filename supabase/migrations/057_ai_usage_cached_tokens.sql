-- ============================================================
-- 057: record how much of each prompt the provider served from cache.
--
-- `prompt_tokens` counts what was SENT; providers bill the cached share
-- at a fraction of the full rate (OpenAI ~25%, Anthropic ~10%). Without
-- this split the usage dashboard can only show tokens, and a number
-- that is 4x what the invoice says makes the two impossible to
-- reconcile. Nullable: providers only started reporting it recently
-- and older rows have no way to know.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
SET search_path = public, extensions, pg_catalog;

ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS cached_prompt_tokens integer;

COMMENT ON COLUMN public.ai_usage_log.cached_prompt_tokens IS
  'Share of prompt_tokens the provider served from its prompt cache (billed at a reduced rate). NULL when not reported.';
