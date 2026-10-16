-- ============================================================
-- 087: several WhatsApp numbers per company
--
-- Until now an account had exactly one whatsapp_config row
-- (UNIQUE(account_id), migration 017) and one conversation per contact
-- (migration 041), so a second number could not be bound and replies had
-- no way to know which number to go out on.
--
--   * whatsapp_config: the per-account UNIQUE goes; `is_primary` marks the
--     number the CRM uses when IT starts a conversation (template from a
--     contact, broadcast). Exactly one primary per account.
--   * conversations.whatsapp_config_id: the number the conversation lives
--     on. Replies always go out through it. Existing WhatsApp
--     conversations are attached to the account's current (only) number.
--   * One conversation per contact PER NUMBER: the same customer writing
--     to two numbers of the same company gets two conversations, each
--     answered from the number they wrote to.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Many numbers per account, one primary.
ALTER TABLE public.whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Every account has at most one row today: that row is its primary.
UPDATE public.whatsapp_config w
   SET is_primary = true
 WHERE NOT EXISTS (
   SELECT 1 FROM public.whatsapp_config o
    WHERE o.account_id = w.account_id AND o.is_primary
 )
   AND w.id = (
   SELECT o.id FROM public.whatsapp_config o
    WHERE o.account_id = w.account_id
    ORDER BY o.created_at, o.id
    LIMIT 1
 );

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_one_primary_per_account
  ON public.whatsapp_config (account_id) WHERE is_primary;

-- An instance can be bound to one row only (it already could not be
-- bound to two accounts; now it cannot be bound twice to one).
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_uazapi_instance_unique
  ON public.whatsapp_config (uazapi_instance_id) WHERE uazapi_instance_id IS NOT NULL;

-- 2. Which number a conversation lives on.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id uuid
    REFERENCES public.whatsapp_config(id) ON DELETE SET NULL;

UPDATE public.conversations c
   SET whatsapp_config_id = w.id
  FROM public.whatsapp_config w
 WHERE w.account_id = c.account_id
   AND w.is_primary
   AND c.channel = 'whatsapp'
   AND c.whatsapp_config_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON public.conversations (whatsapp_config_id);

-- 3. One conversation per contact per number (was: per contact).
-- Instagram / Messenger conversations have no number and keep the
-- one-per-contact rule through the COALESCE.
DROP INDEX IF EXISTS public.idx_conversations_account_contact_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_number_unique
  ON public.conversations (
    account_id,
    contact_id,
    COALESCE(whatsapp_config_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
