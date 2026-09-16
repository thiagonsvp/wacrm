-- A direct-to-WhatsApp Google Ads click that never receives a real gclid
-- (ValueTrack macro left unexpanded — see src/app/go/google-ads/[token]/route.ts)
-- still resolves a five-character protocol (public.google_ads_click_protocols)
-- and still deserves to be traceable from the contact card, even though the
-- lead classifies as organic with no click id to attribute. Store that code
-- on the contact so support can look up which protocol row produced it.
--
-- Idempotent — safe to run multiple times.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS acquisition_protocol TEXT;

COMMENT ON COLUMN public.contacts.acquisition_protocol IS
  'Five-character WhatsApp direct-link protocol code (public.google_ads_click_protocols.code) that resolved this contact, kept even when the lead has no click id and classifies as organic.';
