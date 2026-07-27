-- Preserve the Meta platform that originated a click-to-WhatsApp lead.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS acquisition_source TEXT
    CHECK (acquisition_source IN ('Facebook', 'Instagram'));
