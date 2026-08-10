-- Meta Conversions API: Facebook Page id as the business identifier.
--
-- Click-to-WhatsApp conversions are only attributable under the
-- `business_messaging` contract, which Meta refuses without an identifier
-- for the business:
--
--   subcode 2804116 — "Seu evento ... não tem um parâmetro page_id ou
--   whatsapp_business_account_id"
--
-- A WABA id only exists on the official WhatsApp Business Platform. This
-- CRM also drives UAZAPI, where there is none — which is why those
-- accounts fell back to `action_source: 'other'`, an event Meta accepts
-- and attributes to nothing. Confirmed live on 2026-08-10: 25 qualified
-- leads and 1 purchase were received by Meta and reported zero
-- conversions on the campaign.
--
-- `page_id` is Meta's documented alternative and was verified to pass
-- validation with a real Page. It gives UAZAPI accounts real attribution
-- without migrating their number to the Cloud API.
--
-- The Page must be connected to the dataset in Meta first, otherwise the
-- send fails with subcode 2804065 ("incompatibilidade de página e
-- conjunto de dados").

SET search_path = public, extensions, pg_catalog;

ALTER TABLE public.meta_capi_configs
  ADD COLUMN IF NOT EXISTS page_id text;

COMMENT ON COLUMN public.meta_capi_configs.page_id IS
  'Facebook Page id running the Click-to-WhatsApp ads. Alternative to '
  'waba_id for the business_messaging contract; required for attribution '
  'on UAZAPI, where no WABA id exists. Must be connected to dataset_id in '
  'Meta Events Manager.';
