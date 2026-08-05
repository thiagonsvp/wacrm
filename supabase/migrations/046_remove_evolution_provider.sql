-- ============================================================
-- Remove Evolution API provider support
-- ============================================================

-- Drop Evolution-specific columns from whatsapp_config
ALTER TABLE whatsapp_config
  DROP COLUMN IF EXISTS evolution_base_url,
  DROP COLUMN IF EXISTS evolution_instance_name,
  DROP COLUMN IF EXISTS evolution_api_key;

-- Update provider constraint to only allow 'meta' and 'uazapi'
ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS check_provider_valid;

ALTER TABLE whatsapp_config
  ADD CONSTRAINT check_provider_valid
  CHECK (provider IN ('meta', 'uazapi'));
