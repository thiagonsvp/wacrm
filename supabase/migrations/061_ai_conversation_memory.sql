-- ============================================================
-- 061_ai_conversation_memory.sql — low-cost learning from human replies
--
-- Captures account-scoped customer -> human-agent examples without an
-- extraction model call. Retrieval is lexical and returns at most a few
-- short examples, keeping prompt/token cost bounded.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_conversation_memories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  customer_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  agent_message_id    uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  question            text NOT NULL,
  answer              text NOT NULL,
  fts                 tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(question, '') || ' ' || coalesce(answer, ''))
  ) STORED,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_message_id)
);

CREATE INDEX IF NOT EXISTS ai_conversation_memories_account_idx
  ON ai_conversation_memories (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_conversation_memories_fts_idx
  ON ai_conversation_memories USING gin (fts);

ALTER TABLE ai_conversation_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_conversation_memories_select ON ai_conversation_memories;
CREATE POLICY ai_conversation_memories_select ON ai_conversation_memories FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_conversation_memories_delete ON ai_conversation_memories;
CREATE POLICY ai_conversation_memories_delete ON ai_conversation_memories FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.sanitize_ai_memory(input_text text)
RETURNS text AS $$
  SELECT regexp_replace(
    regexp_replace(coalesce(input_text, ''),
      '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[email]', 'gi'),
    '[+]?[0-9][0-9 ()-]{7,}[0-9]', '[telefone]', 'g'
  );
$$ LANGUAGE sql IMMUTABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.capture_ai_conversation_memory()
RETURNS trigger AS $$
DECLARE
  v_account_id uuid;
  v_question text;
  v_customer_message_id uuid;
  v_previous_sender text;
BEGIN
  IF NEW.sender_type <> 'agent' OR coalesce(trim(NEW.content_text), '') = '' THEN
    RETURN NEW;
  END IF;

  SELECT m.sender_type
    INTO v_previous_sender
  FROM messages m
  WHERE m.conversation_id = NEW.conversation_id
    AND (m.created_at, m.id) < (NEW.created_at, NEW.id)
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1;

  -- Consecutive human replies are one answer sequence; learn only from
  -- the first response that directly follows a customer message.
  IF v_previous_sender IS DISTINCT FROM 'customer' THEN
    RETURN NEW;
  END IF;

  SELECT c.account_id INTO v_account_id
  FROM conversations c
  WHERE c.id = NEW.conversation_id;

  WITH recent AS (
    SELECT m.id,
           m.sender_type,
           m.content_text,
           m.created_at,
           sum(CASE WHEN m.sender_type <> 'customer' THEN 1 ELSE 0 END)
             OVER (ORDER BY m.created_at DESC, m.id DESC) AS boundary
    FROM messages m
    WHERE m.conversation_id = NEW.conversation_id
      AND (m.created_at, m.id) < (NEW.created_at, NEW.id)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 10
  ), customer_run AS (
    SELECT * FROM recent
    WHERE sender_type = 'customer'
      AND boundary = 0
      AND coalesce(trim(content_text), '') <> ''
  )
  SELECT string_agg(content_text, ' ' ORDER BY created_at, id),
         (array_agg(id ORDER BY created_at, id))[1]
    INTO v_question, v_customer_message_id
  FROM customer_run;

  IF v_account_id IS NULL OR coalesce(trim(v_question), '') = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO ai_conversation_memories (
    account_id,
    conversation_id,
    customer_message_id,
    agent_message_id,
    question,
    answer
  ) VALUES (
    v_account_id,
    NEW.conversation_id,
    v_customer_message_id,
    NEW.id,
    left(public.sanitize_ai_memory(v_question), 1200),
    left(public.sanitize_ai_memory(NEW.content_text), 1200)
  )
  ON CONFLICT (agent_message_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS capture_ai_conversation_memory_trigger ON messages;
CREATE TRIGGER capture_ai_conversation_memory_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_ai_conversation_memory();

-- Seed the memory with existing immediate customer -> human pairs.
WITH ordered AS (
  SELECT m.id,
         m.conversation_id,
         m.sender_type,
         m.content_text,
         m.created_at,
         c.account_id,
         lag(m.id) OVER w AS previous_id,
         lag(m.sender_type) OVER w AS previous_sender,
         lag(m.content_text) OVER w AS previous_text
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.created_at, m.id)
)
INSERT INTO ai_conversation_memories (
  account_id,
  conversation_id,
  customer_message_id,
  agent_message_id,
  question,
  answer,
  created_at
)
SELECT account_id,
       conversation_id,
       previous_id,
       id,
       left(public.sanitize_ai_memory(previous_text), 1200),
       left(public.sanitize_ai_memory(content_text), 1200),
       created_at
FROM ordered
WHERE sender_type = 'agent'
  AND previous_sender = 'customer'
  AND coalesce(trim(previous_text), '') <> ''
  AND coalesce(trim(content_text), '') <> ''
ON CONFLICT (agent_message_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.match_ai_conversation_memory_fts(
  p_account_id uuid,
  p_query text,
  p_match_count integer
)
RETURNS TABLE (id uuid, question text, answer text, rank real) AS $$
  SELECT m.id,
         m.question,
         m.answer,
         ts_rank(m.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM ai_conversation_memories m
  WHERE m.account_id = p_account_id
    AND m.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC, m.created_at DESC
  LIMIT LEAST(GREATEST(p_match_count, 0), 3);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_conversation_memory_fts(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_ai_conversation_memory_fts(uuid, text, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.capture_ai_conversation_memory() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sanitize_ai_memory(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_ai_memory(text) TO service_role;
