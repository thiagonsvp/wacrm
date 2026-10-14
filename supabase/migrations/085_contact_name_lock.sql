-- ============================================================
-- 085: keep a contact name edited in the CRM
--
-- Every inbound WhatsApp message rewrites contacts.name with the name
-- WhatsApp reports, which silently undid any rename done in the inbox.
-- When an agent renames a contact, this is stamped and the webhook stops
-- touching the name. Clearing the name in the inbox clears the stamp, so
-- the WhatsApp name takes over again.
-- ============================================================
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS name_locked_at timestamptz;
