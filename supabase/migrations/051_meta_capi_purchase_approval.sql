-- Human approval for Purchase conversions before they reach Meta.
--
-- On 2026-08-12 the AI marked a deal closed-won four minutes after
-- creating it, on the strength of the customer answering "Ok" to the
-- seller's closing pitch. The same customer was still price-shopping
-- twelve minutes later. An earlier deal reached Meta the same way, for
-- R$4.899, from a customer who had said they would "mandar o link para a
-- esposa".
--
-- A conversion cannot be recalled. Once Meta has it, the ad account is
-- optimising toward people who look like a non-buyer, and the money is
-- spent finding more of them.
--
-- Purchases only. QualifiedLead stays automatic: it runs ~11x/day, it
-- carries no amount, and a queue that size gets rubber-stamped — which
-- would cost the review its meaning while delaying events Meta wants
-- fresh. Money gets a human; volume does not.

SET search_path = public, extensions, pg_catalog;

-- 'pending'  — held for review, never sent
-- 'rejected' — a human said no; kept as a record, never retried
ALTER TABLE public.meta_capi_events
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text;

-- Only one live decision per deal+event. 'sent' already had this guard;
-- extend it so a deal cannot sit in the queue twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_capi_events_pending
  ON public.meta_capi_events (deal_id, event_name)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_meta_capi_events_pending
  ON public.meta_capi_events (account_id, created_at DESC)
  WHERE status = 'pending';

-- Per-account switch. Defaults ON: an operator who never opens the queue
-- should under-report rather than send conversions nobody checked.
ALTER TABLE public.meta_capi_configs
  ADD COLUMN IF NOT EXISTS require_purchase_approval boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.meta_capi_configs.require_purchase_approval IS
  'Hold Purchase events for human approval instead of sending them '
  'immediately. QualifiedLead is never held.';

COMMENT ON COLUMN public.meta_capi_events.review_note IS
  'Why a human approved or rejected this conversion.';
