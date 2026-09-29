-- Lets an account forward every lead captured by
-- src/app/api/google-ads/leads/[token]/route.ts to a second URL (n8n,
-- Zapier, a legacy system, ...) in addition to storing it as a contact.
-- Optional — null means "don't forward".
--
-- Idempotent — safe to run multiple times.

ALTER TABLE public.google_ads_configs
  ADD COLUMN IF NOT EXISTS lead_forward_webhook_url text;
