-- ============================================================
-- 038_conversation_queue.sql — Conversation assignment queue
--
-- Adds referential integrity + an index to the existing (since 001)
-- `conversations.assigned_agent_id` column, and tightens `messages`
-- write access so an agent can't write into a thread assigned to a
-- teammate. Admin/owner keep an override (they can jump into any
-- thread), matching the API-route check added alongside this
-- migration in src/app/api/whatsapp/send/route.ts.
--
-- NOTE on the FK target: `assigned_agent_id` is populated with
-- `auth.uid()` (see message-thread.tsx's handleAssignChange, which
-- writes `profile.user_id`), not `profiles.id`. profiles.id is a
-- separate surrogate key. So the FK below targets
-- `profiles(user_id)` — the column that is actually UNIQUE and
-- actually matches the stored values — not `profiles(id)`.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- FK: assigned_agent_id -> profiles(user_id)
--
-- ON DELETE SET NULL so a removed account member doesn't leave the
-- column pointing at a dangling profile — the conversation just
-- falls back into the unassigned queue.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_assigned_agent_id_fkey'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_assigned_agent_id_fkey
      FOREIGN KEY (assigned_agent_id) REFERENCES profiles(user_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_assigned_agent
  ON conversations(assigned_agent_id);

-- ------------------------------------------------------------
-- messages_modify — was FOR ALL (agent-membership only). A separate
-- `messages_select` policy (added after 017, viewer-level, no
-- assignment condition) already covers reads independently — Postgres
-- OR's multiple permissive policies for the same command, so it stays
-- untouched here and keeps the "Todas" queue view showing conversations
-- assigned to a teammate, just not letting you reply into them.
-- `messages_modify` is replaced with per-command write policies
-- (INSERT/UPDATE/DELETE) carrying the assignment check. This is
-- defense in depth; the primary UX-facing block lives in the
-- /api/whatsapp/send route. Admin/owner bypass so escalation into
-- someone else's thread stays possible.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS messages_modify ON messages;

CREATE POLICY messages_write ON messages FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND (
        c.assigned_agent_id IS NULL
        OR c.assigned_agent_id = auth.uid()
        OR is_account_member(c.account_id, 'admin')
      )
  )
);

CREATE POLICY messages_update ON messages FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND (
        c.assigned_agent_id IS NULL
        OR c.assigned_agent_id = auth.uid()
        OR is_account_member(c.account_id, 'admin')
      )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND (
        c.assigned_agent_id IS NULL
        OR c.assigned_agent_id = auth.uid()
        OR is_account_member(c.account_id, 'admin')
      )
  )
);

CREATE POLICY messages_delete ON messages FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND (
        c.assigned_agent_id IS NULL
        OR c.assigned_agent_id = auth.uid()
        OR is_account_member(c.account_id, 'admin')
      )
  )
);
