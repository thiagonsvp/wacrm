-- ============================================================
-- 049_messaging_channels.sql — Instagram Direct + Messenger
--
-- Someone writing from Instagram Direct or Messenger has no phone
-- number. Meta identifies them by an opaque id scoped to the Page they
-- wrote to (IGSID / PSID): the same person writing to two Pages is two
-- different ids, and nothing links either back to a phone.
--
-- The schema assumed WhatsApp everywhere — contacts.phone was NOT NULL
-- and identity was the normalised phone — so a channel discriminator and
-- a second identity key are what make the other two channels possible.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

SET search_path = public, extensions, pg_catalog;

ALTER TABLE public.contacts
  ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp', 'instagram', 'messenger')),
  ADD COLUMN IF NOT EXISTS external_id text;

-- Partial, mirroring the phone index (itself partial on
-- phone_normalized <> ''), so the two never contend for the same row: a
-- WhatsApp contact is unique by phone, a Direct contact by its
-- page-scoped id. phone_normalized is GENERATED from phone, so a null
-- phone yields a null and simply falls out of the phone index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_channel_external
  ON public.contacts (account_id, channel, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp', 'instagram', 'messenger'));

CREATE INDEX IF NOT EXISTS idx_conversations_account_channel
  ON public.conversations (account_id, channel);

-- Separate from whatsapp_config on purpose: a company can run WhatsApp
-- through an unofficial provider while its Direct runs on the official
-- Meta app, and the two carry entirely different credentials.
CREATE TABLE IF NOT EXISTS public.meta_messaging_configs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  page_id              text,
  instagram_account_id text,
  page_access_token    text,          -- AES-256-GCM encrypted
  verify_token         text,
  is_active            boolean NOT NULL DEFAULT false,
  instagram_enabled    boolean NOT NULL DEFAULT true,
  messenger_enabled    boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Inbound resolves the company from the id Meta sends, so both must be
-- unique across the deployment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_messaging_page
  ON public.meta_messaging_configs (page_id) WHERE page_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_messaging_ig
  ON public.meta_messaging_configs (instagram_account_id) WHERE instagram_account_id IS NOT NULL;

ALTER TABLE public.meta_messaging_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_messaging_select ON public.meta_messaging_configs;
CREATE POLICY meta_messaging_select ON public.meta_messaging_configs FOR SELECT
  USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS meta_messaging_insert ON public.meta_messaging_configs;
CREATE POLICY meta_messaging_insert ON public.meta_messaging_configs FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_messaging_update ON public.meta_messaging_configs;
CREATE POLICY meta_messaging_update ON public.meta_messaging_configs FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_messaging_delete ON public.meta_messaging_configs;
CREATE POLICY meta_messaging_delete ON public.meta_messaging_configs FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON public.meta_messaging_configs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.meta_messaging_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
