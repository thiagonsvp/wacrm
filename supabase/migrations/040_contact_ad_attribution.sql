ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS acquisition_source_id TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_campaign TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_ad_text TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_url TEXT;
