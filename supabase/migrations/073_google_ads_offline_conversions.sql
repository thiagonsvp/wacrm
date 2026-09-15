-- Google Ads lead attribution and offline conversion uploads.
--
-- The website/LP sends the click identifiers and UTM fields to a
-- capability-token endpoint. Later, when the contact becomes qualified or a
-- deal is won, the CRM uploads that outcome to the matching Google Ads
-- conversion action. Credentials are encrypted by the application before
-- being persisted. Idempotent: safe to run more than once.

SET search_path = public, extensions, pg_catalog;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS acquisition_click_id_type text,
  ADD COLUMN IF NOT EXISTS acquisition_medium text,
  ADD COLUMN IF NOT EXISTS acquisition_term text,
  ADD COLUMN IF NOT EXISTS acquisition_content text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contacts'::regclass
      AND conname = 'contacts_acquisition_click_id_type_check'
  ) THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_acquisition_click_id_type_check
      CHECK (acquisition_click_id_type IN ('gclid', 'gbraid', 'wbraid'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.google_ads_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_id text NOT NULL,
  login_customer_id text,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  refresh_token text NOT NULL,
  developer_token text,
  qualified_lead_conversion_action_id text,
  purchase_conversion_action_id text,
  website_url text,
  webhook_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  is_active boolean NOT NULL DEFAULT false,
  send_qualified_lead boolean NOT NULL DEFAULT true,
  send_purchase boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_ads_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_ads_configs_select ON public.google_ads_configs;
CREATE POLICY google_ads_configs_select ON public.google_ads_configs FOR SELECT
  USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS google_ads_configs_insert ON public.google_ads_configs;
CREATE POLICY google_ads_configs_insert ON public.google_ads_configs FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS google_ads_configs_update ON public.google_ads_configs;
CREATE POLICY google_ads_configs_update ON public.google_ads_configs FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS google_ads_configs_delete ON public.google_ads_configs;
CREATE POLICY google_ads_configs_delete ON public.google_ads_configs FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON public.google_ads_configs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.google_ads_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.google_ads_conversion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  event_name text NOT NULL CHECK (event_name IN ('QualifiedLead', 'Purchase')),
  order_id text NOT NULL,
  click_id_type text NOT NULL CHECK (click_id_type IN ('gclid', 'gbraid', 'wbraid')),
  click_id text NOT NULL,
  value numeric,
  currency text,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_google_ads_conversion_events_sent
  ON public.google_ads_conversion_events(deal_id, event_name)
  WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_google_ads_conversion_events_account
  ON public.google_ads_conversion_events(account_id, created_at DESC);

ALTER TABLE public.google_ads_conversion_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS google_ads_conversion_events_select ON public.google_ads_conversion_events;
CREATE POLICY google_ads_conversion_events_select ON public.google_ads_conversion_events FOR SELECT
  USING (public.is_account_member(account_id));

COMMENT ON COLUMN public.google_ads_configs.webhook_token IS
  'Capability token embedded in the customer website/LP lead endpoint URL.';
COMMENT ON COLUMN public.contacts.acquisition_click_id_type IS
  'Which Google click identifier acquisition_gclid contains: gclid, gbraid or wbraid.';

