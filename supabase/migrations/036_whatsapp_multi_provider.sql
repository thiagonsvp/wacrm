-- ============================================================
-- whatsapp_config: multi-provider support (Meta Cloud API + Evolution API)
--
-- Adds a `provider` discriminator plus the Evolution-only connection
-- fields. `phone_number_id` becomes nullable because Evolution has no
-- equivalent concept (it identifies a session by `instance_name`, not
-- a Meta-issued phone number id).
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'evolution'));

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS evolution_base_url TEXT;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS evolution_instance_name TEXT;

-- Encrypted the same way as access_token/verify_token (see
-- src/lib/whatsapp/encryption.ts) before being written.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS evolution_api_key TEXT;

ALTER TABLE whatsapp_config
  ALTER COLUMN phone_number_id DROP NOT NULL;

-- access_token is NOT NULL in the original schema but Evolution rows
-- never populate it (they use evolution_api_key instead) — relax it
-- the same way so provider='evolution' rows can be inserted.
ALTER TABLE whatsapp_config
  ALTER COLUMN access_token DROP NOT NULL;
