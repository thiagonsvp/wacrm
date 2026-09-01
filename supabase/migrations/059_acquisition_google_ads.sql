-- ============================================================
-- 059: campaign attribution for Google Ads alongside Meta.
--
-- Until now every acquisition column assumed a Meta click-to-WhatsApp
-- lead: `acquisition_source` was CHECK-constrained to Facebook /
-- Instagram, and the only click id stored was `ctwa_clid`. Accounts
-- also running Google Ads had nowhere to put a lead's origin, so those
-- leads landed indistinguishable from organic ones.
--
-- What changes:
--   * `acquisition_source` accepts 'Google'.
--   * `acquisition_gclid` stores the Google click id (gclid, or the
--     wbraid / gbraid that replace it on iOS app-to-web journeys).
--
-- Everything else is reused as-is, because those columns were never
-- Meta-specific in meaning: `acquisition_campaign` holds the campaign
-- name (utm_campaign for Google), `acquisition_url` the landing page,
-- `acquisition_source_id` the ad/campaign id.
--
-- The two click-id columns stay separate on purpose: `ctwa_clid` is
-- what the Meta Conversions API sends back for attribution, and mixing
-- a gclid into it would push Google leads to Meta as unattributable
-- events (see lib/meta/dispatch.ts, which treats a missing ctwa_clid as
-- "organic — do not report").
--
-- Idempotent — safe to run multiple times.
-- ============================================================
SET search_path = public, extensions, pg_catalog;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS acquisition_gclid TEXT;

DO $$
DECLARE c record;
BEGIN
  -- Drop whatever CHECK currently constrains `acquisition_source`,
  -- whatever Postgres named it (039 created it inline).
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.contacts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%acquisition_source%'
  LOOP
    EXECUTE format('ALTER TABLE public.contacts DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.contacts
    ADD CONSTRAINT contacts_acquisition_source_check
    CHECK (acquisition_source IN ('Facebook', 'Instagram', 'Google'));
END $$;

COMMENT ON COLUMN public.contacts.acquisition_gclid IS
  'Google Ads click id (gclid / wbraid / gbraid), parsed from the first message text. NULL for Meta and organic leads.';

COMMENT ON COLUMN public.contacts.acquisition_ctwa_clid IS
  'Meta click-to-WhatsApp click id, required by the Conversions API. NULL for Google and organic leads.';

-- Leads are looked up by click id when importing offline conversions
-- back into Google Ads. Partial: the column is null for every Meta and
-- organic contact, which is most of the table.
CREATE INDEX IF NOT EXISTS idx_contacts_acquisition_gclid
  ON public.contacts(account_id, acquisition_gclid)
  WHERE acquisition_gclid IS NOT NULL;
