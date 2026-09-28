-- Bumps the WhatsApp direct-link protocol from 5 to 6 characters (see
-- src/lib/google-ads/protocol.ts). The CHECK is widened to accept both
-- lengths, not just 6, so protocols already minted under the old format
-- and still resolvable within the 90-day window (src/lib/google-ads/protocol.ts
-- MAX_AGE_DAYS) do not fail on a re-read or any future write to the row.
--
-- Idempotent — safe to run multiple times.

ALTER TABLE public.google_ads_click_protocols
  DROP CONSTRAINT IF EXISTS google_ads_click_protocols_code_check;

ALTER TABLE public.google_ads_click_protocols
  ADD CONSTRAINT google_ads_click_protocols_code_check
  CHECK (code ~ '^[A-Z2-9]{5,6}$');

COMMENT ON TABLE public.google_ads_click_protocols IS
  'Maps a five- or six-character WhatsApp message protocol to a Google Ads click.';
