-- Copies of inbound WhatsApp attachments (src/lib/storage/inbound-media.ts).
-- UAZAPI purges its own copy after ~2 days; the webhook now copies each
-- file here at ingestion and a daily sweep deletes copies older than 60
-- days.
--
-- Separate from `chat-media` (outbound, composer uploads) because inbound
-- needs a different policy on both axes: any MIME type a customer can send
-- (no allow-list — a customer's .zip or .mov must not be rejected), and a
-- retention sweep that must never touch outbound media.
--
-- Public: served straight from the Storage CDN with no proxy hop; URLs
-- carry a random uuid. No storage.objects policies on purpose — only the
-- service role (webhook + sweep) ever writes or lists this bucket.
--
-- 50 MB per file: the Supabase default global upload cap. Larger files
-- keep their original provider URL.
--
-- Idempotent — safe to re-run.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('inbound-media', 'inbound-media', TRUE, 52428800, NULL)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
