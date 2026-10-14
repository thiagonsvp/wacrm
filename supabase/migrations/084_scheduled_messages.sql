-- ============================================================
-- 084: scheduled messages
--
-- An agent queues a message (text, audio, image, video or document) to go
-- out on a conversation at a future date/time. One "schedule" can hold
-- several items (e.g. a voice note plus a PDF plus a text); they share a
-- group_id and go out in `position` order.
--
-- Delivery: Vercel Hobby only allows daily crons, so the per-minute tick
-- comes from Postgres itself (pg_cron + pg_net) calling
-- /api/cron/scheduled-messages. The job reads the app URL and the cron
-- secret from Vault and does nothing until both exist — see the two
-- `vault.create_secret` lines at the bottom. The inbox also triggers the
-- same dispatch every minute while it is open, as a fallback.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  group_id uuid NOT NULL,
  position int NOT NULL DEFAULT 0,
  message_type text NOT NULL CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document')),
  content_text text,
  media_url text,
  media_path text,
  filename text,
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'canceled')),
  attempts int NOT NULL DEFAULT 0,
  error_message text,
  sent_message_id uuid,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_messages_due_idx
  ON public.scheduled_messages (send_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS scheduled_messages_conversation_idx
  ON public.scheduled_messages (conversation_id, send_at);

ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduled_messages_select ON public.scheduled_messages;
CREATE POLICY scheduled_messages_select ON public.scheduled_messages FOR SELECT
  USING (public.is_account_member(account_id));

-- Read-only for signed-in users. Every write (schedule, cancel, dispatch)
-- goes through the API with the service role, after the API has checked
-- the conversation belongs to the caller's account and that the caller may
-- write on it (assignment lock). A direct-from-browser write could
-- otherwise point a row at another account's conversation, or rewrite the
-- text, time or status of a teammate's schedule.
DROP POLICY IF EXISTS scheduled_messages_insert ON public.scheduled_messages;
DROP POLICY IF EXISTS scheduled_messages_update ON public.scheduled_messages;
REVOKE INSERT, UPDATE, DELETE ON public.scheduled_messages FROM anon, authenticated;

-- ------------------------------------------------------------
-- Claim due items atomically. SKIP LOCKED lets the pg_cron tick and an
-- open inbox dispatch at the same minute without sending anything twice.
-- A whole group is claimed together so its items keep their order.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_due_scheduled_messages(
  p_limit int DEFAULT 50,
  p_account_id uuid DEFAULT NULL
) RETURNS SETOF public.scheduled_messages
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH due_groups AS (
    SELECT DISTINCT group_id
    FROM scheduled_messages
    WHERE status = 'pending'
      AND send_at <= now()
      AND (p_account_id IS NULL OR account_id = p_account_id)
    LIMIT p_limit
  ),
  claimed AS (
    SELECT id FROM scheduled_messages
    WHERE status = 'pending'
      AND group_id IN (SELECT group_id FROM due_groups)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE scheduled_messages s
  SET status = 'sending', attempts = s.attempts + 1, updated_at = now()
  FROM claimed
  WHERE s.id = claimed.id
  RETURNING s.*;
$$;

REVOKE ALL ON FUNCTION public.claim_due_scheduled_messages(int, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_scheduled_messages(int, uuid) TO service_role;

-- ------------------------------------------------------------
-- Attached audio files (not just recorded voice notes): allow the formats
-- WhatsApp accepts for audio on the outbound bucket.
-- ------------------------------------------------------------
UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT array_agg(DISTINCT m)
  FROM unnest(allowed_mime_types || ARRAY['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/x-m4a']) AS m
)
WHERE id = 'chat-media';

-- ------------------------------------------------------------
-- Per-minute tick.
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dispatch-scheduled-messages';
SELECT cron.schedule(
  'dispatch-scheduled-messages',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'app_url') || '/api/cron/scheduled-messages',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  WHERE EXISTS (SELECT 1 FROM public.scheduled_messages WHERE status = 'pending' AND send_at <= now())
    AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'app_url')
    AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_secret');
  $cron$
);

-- Run once, by hand, with the real values (never commit them):
--   SELECT vault.create_secret('https://<your-app-domain>', 'app_url');
--   SELECT vault.create_secret('<same value as CRON_SECRET in Vercel>', 'cron_secret');
