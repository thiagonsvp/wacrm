-- The account's Google Ads tracking template (Settings > Account settings
-- > Tracking, "Tracking template") wraps every ad click with more
-- ValueTrack parameters than the redirect (src/app/go/google-ads/[token]/
-- route.ts) previously read: {adgroupid}, {matchtype}, {network},
-- {device}, {placement}. None of these map onto an existing utm_* column
-- (unlike {creative}/{keyword}, which already reuse utm_content/utm_term),
-- so they get their own columns, mirrored on both the protocol row and
-- the contact it resolves to.
--
-- Idempotent — safe to run multiple times.

ALTER TABLE public.google_ads_click_protocols
  ADD COLUMN IF NOT EXISTS adgroup_id text,
  ADD COLUMN IF NOT EXISTS match_type text,
  ADD COLUMN IF NOT EXISTS network text,
  ADD COLUMN IF NOT EXISTS device text,
  ADD COLUMN IF NOT EXISTS placement text;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS acquisition_adgroup_id text,
  ADD COLUMN IF NOT EXISTS acquisition_match_type text,
  ADD COLUMN IF NOT EXISTS acquisition_network text,
  ADD COLUMN IF NOT EXISTS acquisition_device text,
  ADD COLUMN IF NOT EXISTS acquisition_placement text;
