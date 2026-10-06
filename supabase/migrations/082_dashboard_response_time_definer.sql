-- Fix for 081: dashboard_response_time timed out for real users.
--
-- As SECURITY INVOKER it ran under messages' RLS, whose policy runs an
-- EXISTS + is_account_member() per row. Across ~85k messages in the
-- 4-week window that blew the 8s statement_timeout of the authenticated
-- role (the service role, which bypasses RLS, ran it in ~200ms), and the
-- dashboard card spun forever.
--
-- Now SECURITY DEFINER, so RLS is skipped and the planner walks only the
-- caller's conversations via idx_messages_conversation_created. The
-- account scoping RLS used to provide is done explicitly instead:
--   * the account is the caller's current one (profiles.account_id), AND
--   * the caller must actually be a member of it (is_account_member).
-- The membership check matters: per migration 047, profiles.account_id
-- only says which company the UI points at and a user can write it, so
-- without the check anyone could read another company's aggregates by
-- pointing their profile at it.
--
-- Body is otherwise identical to 081. Idempotent — safe to re-run.

CREATE OR REPLACE FUNCTION public.dashboard_response_time(
  p_days integer DEFAULT 28,
  p_tz text DEFAULT 'America/Sao_Paulo'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH acct AS (
  SELECT p.account_id
  FROM profiles p
  WHERE p.user_id = auth.uid()
    AND public.is_account_member(p.account_id)
),
m AS (
  SELECT
    msg.conversation_id,
    msg.sender_type,
    msg.created_at,
    count(*) FILTER (WHERE msg.sender_type = 'agent') OVER (
      PARTITION BY msg.conversation_id
      ORDER BY msg.created_at, msg.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS turn
  FROM messages msg
  JOIN conversations c ON c.id = msg.conversation_id
  WHERE c.account_id = (SELECT account_id FROM acct)
    AND msg.created_at >= now() - make_interval(days => p_days)
    AND msg.sender_type IN ('customer', 'agent')
),
turns AS (
  SELECT
    min(created_at) FILTER (WHERE sender_type = 'customer') AS asked_at,
    min(created_at) FILTER (WHERE sender_type = 'agent') AS answered_at
  FROM m
  GROUP BY conversation_id, turn
),
s AS (
  SELECT
    asked_at AT TIME ZONE p_tz AS asked_local,
    extract(epoch FROM answered_at - asked_at) / 60.0 AS minutes
  FROM turns
  WHERE asked_at IS NOT NULL
    AND answered_at IS NOT NULL
    AND answered_at > asked_at
),
wk AS (
  SELECT date_trunc('week', now() AT TIME ZONE p_tz) AS this_start
),
by_dow AS (
  SELECT
    extract(isodow FROM asked_local)::int - 1 AS dow,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS median,
    count(*) AS n
  FROM s
  GROUP BY 1
)
SELECT jsonb_build_object(
  'buckets', (
    SELECT jsonb_agg(
      jsonb_build_object(
        'dow', d.dow,
        'median_minutes', b.median,
        'samples', coalesce(b.n, 0)
      )
      ORDER BY d.dow
    )
    FROM generate_series(0, 6) AS d(dow)
    LEFT JOIN by_dow b ON b.dow = d.dow
  ),
  'this_week', (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.minutes)
    FROM s, wk
    WHERE s.asked_local >= wk.this_start
  ),
  'last_week', (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.minutes)
    FROM s, wk
    WHERE s.asked_local >= wk.this_start - interval '7 days'
      AND s.asked_local < wk.this_start
  )
);
$$;

REVOKE ALL ON FUNCTION public.dashboard_response_time(integer, text) FROM PUBLIC;
-- Supabase's default privileges grant anon EXECUTE on new public
-- functions explicitly, which REVOKE ... FROM PUBLIC does not undo.
REVOKE ALL ON FUNCTION public.dashboard_response_time(integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.dashboard_response_time(integer, text) TO authenticated;
