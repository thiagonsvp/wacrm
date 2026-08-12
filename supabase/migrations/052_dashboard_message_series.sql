-- Aggregate the dashboard's message series in the database.
--
-- `loadConversationsSeries` fetched every message row in the range and
-- counted them in the browser. PostgREST caps a response at 1000 rows, so
-- with ~11,500 messages in 30 days the chart only ever saw the oldest
-- ~1000 — about two and a half days — and drew flat zero for the rest.
-- It looked like the CRM had stopped recording messages on 28 July while
-- it was in fact handling over a thousand a day.
--
-- Counting rows is not something to ship over the wire. GROUP BY here
-- returns one row per day regardless of volume, and the cap stops
-- mattering.
--
-- SECURITY INVOKER (the default) is deliberate: the caller's RLS policies
-- still apply, so this can never widen what a user can see, and a member
-- of one company keeps seeing only their own company's traffic.

SET search_path = public, extensions, pg_catalog;

CREATE OR REPLACE FUNCTION public.dashboard_message_series(
  p_days int,
  p_tz   text DEFAULT 'UTC'
)
RETURNS TABLE (day date, incoming bigint, outgoing bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  WITH bounds AS (
    -- Day boundaries follow the viewer's clock, not UTC. In Brazil
    -- (UTC-3) a UTC bucket would push every evening message into the
    -- next day.
    SELECT (date_trunc('day', timezone(p_tz, now())) - make_interval(days => p_days - 1))::date AS first_day
  ),
  days AS (
    SELECT generate_series(
      (SELECT first_day FROM bounds),
      (timezone(p_tz, now()))::date,
      '1 day'::interval
    )::date AS day
  ),
  counted AS (
    SELECT
      (timezone(p_tz, m.created_at))::date AS day,
      count(*) FILTER (WHERE m.sender_type = 'customer') AS incoming,
      -- agent and bot both read as outgoing, matching the old client code
      count(*) FILTER (WHERE m.sender_type <> 'customer') AS outgoing
    FROM messages m
    WHERE m.created_at >= (SELECT first_day FROM bounds)::timestamp AT TIME ZONE p_tz
    GROUP BY 1
  )
  SELECT d.day,
         COALESCE(c.incoming, 0) AS incoming,
         COALESCE(c.outgoing, 0) AS outgoing
  FROM days d
  LEFT JOIN counted c ON c.day = d.day
  ORDER BY d.day;
$$;

COMMENT ON FUNCTION public.dashboard_message_series(int, text) IS
  'Daily incoming/outgoing message counts for the dashboard chart, '
  'bucketed in the caller''s timezone. Aggregates server-side so the '
  'PostgREST 1000-row cap cannot truncate the series.';

GRANT EXECUTE ON FUNCTION public.dashboard_message_series(int, text) TO authenticated;
