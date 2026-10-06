-- First-response time by weekday for the dashboard
-- (src/lib/dashboard/queries.ts loadResponseTime).
--
-- Computed in SQL rather than by pulling messages into the browser: the
-- old client-side version fetched 14 days of rows in one request, which
-- PostgREST caps at 1000 — on a busy account the average was silently
-- computed from a truncated sample.
--
-- Rules:
--   * A "turn" is the run of customer messages up to the next HUMAN reply
--     (sender_type = 'agent': inbox composer, API, or the agent's own
--     phone). Bot messages (AI auto-reply, automations, flows) are
--     ignored — they neither answer nor reset the wait — so the number
--     reflects the team, not the automation.
--   * Response time = first human reply - first customer message of the
--     turn. Each turn counts once, however many messages the customer
--     sent while waiting.
--   * Median, not average: one message left overnight would otherwise
--     dominate a whole weekday.
--   * Weekday and week boundaries use the business timezone
--     (America/Sao_Paulo by default), not the server's UTC.
--
-- SECURITY INVOKER: runs under the caller's RLS, and is additionally
-- scoped to the caller's own account so the planner walks that account's
-- conversations via the index below instead of scanning every message.
--
-- Idempotent — safe to re-run.

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at);

CREATE OR REPLACE FUNCTION public.dashboard_response_time(
  p_days integer DEFAULT 28,
  p_tz text DEFAULT 'America/Sao_Paulo'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH acct AS (
  SELECT account_id FROM profiles WHERE user_id = auth.uid()
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
GRANT EXECUTE ON FUNCTION public.dashboard_response_time(integer, text) TO authenticated;
