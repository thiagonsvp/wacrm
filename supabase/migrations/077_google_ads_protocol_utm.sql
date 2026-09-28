-- The WhatsApp direct-link protocol (see 074_google_ads_whatsapp_protocols.sql)
-- only ever stored the Google click id + numeric ValueTrack campaign id.
-- Landing pages that decorate their own WhatsApp buttons via the CRM's
-- tracking snippet (src/lib/google-ads/snippet.ts) also carry generic
-- utm_source/utm_medium/utm_campaign/utm_content/utm_term, which used to
-- get glued as raw [utm_x:y] text into the WhatsApp message because the
-- protocol row had nowhere to keep them. Add columns so the redirect
-- (src/app/go/google-ads/[token]/route.ts) can store them instead and the
-- message stays just "Protocolo: XXXXXX".
--
-- Idempotent — safe to run multiple times.

ALTER TABLE public.google_ads_click_protocols
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_term text;
