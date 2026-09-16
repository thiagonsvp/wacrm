-- Short-lived Google Ads click references for campaigns that open WhatsApp
-- directly. The ad hits a CRM redirect first; the redirect stores the click
-- identifiers and adds a five-character protocol to the pre-filled WhatsApp
-- message. The inbound WhatsApp webhook then joins that protocol to the
-- sender's phone/contact.

SET search_path = public, extensions, pg_catalog;

CREATE TABLE IF NOT EXISTS public.google_ads_whatsapp_settings (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  phone text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at ON public.google_ads_whatsapp_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.google_ads_whatsapp_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.google_ads_whatsapp_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS google_ads_whatsapp_settings_select ON public.google_ads_whatsapp_settings;
CREATE POLICY google_ads_whatsapp_settings_select ON public.google_ads_whatsapp_settings FOR SELECT
  USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS google_ads_whatsapp_settings_insert ON public.google_ads_whatsapp_settings;
CREATE POLICY google_ads_whatsapp_settings_insert ON public.google_ads_whatsapp_settings FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS google_ads_whatsapp_settings_update ON public.google_ads_whatsapp_settings;
CREATE POLICY google_ads_whatsapp_settings_update ON public.google_ads_whatsapp_settings FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS public.google_ads_click_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z2-9]{5}$'),
  click_id text,
  click_id_type text CHECK (click_id_type IN ('gclid', 'gbraid', 'wbraid')),
  campaign_id text,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_ads_click_protocols_account_created
  ON public.google_ads_click_protocols(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_google_ads_click_protocols_unclaimed
  ON public.google_ads_click_protocols(account_id, code)
  WHERE contact_id IS NULL;

ALTER TABLE public.google_ads_click_protocols ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS google_ads_click_protocols_select ON public.google_ads_click_protocols;
CREATE POLICY google_ads_click_protocols_select ON public.google_ads_click_protocols FOR SELECT
  USING (public.is_account_member(account_id));

COMMENT ON TABLE public.google_ads_click_protocols IS
  'Maps a five-character WhatsApp message protocol to a Google Ads click.';
