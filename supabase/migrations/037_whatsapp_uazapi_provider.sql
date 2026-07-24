-- ============================================================
-- whatsapp_config: add UAZAPI provider (unofficial WhatsApp, QR-code)
--
-- Same shape as the Evolution addition in 036: a provider-specific
-- set of columns, plus widening the provider CHECK constraint.
-- UAZAPI identifies a session by an instance `token` returned by
-- POST /instance/init, so that token is stored (encrypted) instead
-- of a static API key.
-- ============================================================

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_provider_check;

ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_check
    CHECK (provider IN ('meta', 'evolution', 'uazapi'));

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS uazapi_base_url TEXT;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS uazapi_instance_name TEXT;

-- Encrypted the same way as evolution_api_key before being written.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS uazapi_token TEXT;

-- ============================================================
-- whatsapp_webhook_debug — TEMP DIAGNOSTIC
--
-- Raw-body dump for inbound UAZAPI webhook deliveries, written
-- best-effort before any parsing is attempted. The exact payload
-- shape UAZAPI sends for inbound messages could not be confirmed
-- from documentation, so this table lets us inspect real deliveries
-- and correct the parser if needed. No RLS — read via service role
-- only. Remove this table (and the insert in the webhook route) once
-- the payload shape is confirmed and the parser is verified against
-- real traffic.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_webhook_debug (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  raw_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
