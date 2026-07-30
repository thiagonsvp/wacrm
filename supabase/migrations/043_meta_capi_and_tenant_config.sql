-- ============================================================
-- 043_meta_capi_and_tenant_config.sql
--
-- Two related goals:
--
--   1. Send conversions back to Meta (Conversions API for Business
--      Messaging), so ads that click to WhatsApp can optimise for
--      qualified leads and purchases instead of for raw message volume.
--
--   2. Move the remaining business configuration out of environment
--      variables and hardcoded strings, so a new client can be set up
--      entirely from the Settings UI. Env vars are per-deployment, not
--      per-account, and editing code per customer does not scale.
--
-- Idempotent — safe to run multiple times.
--
-- Every object is schema-qualified and the search_path is pinned below.
-- The Supabase SQL editor does not always run with `public` on the
-- search_path, and an unqualified `ALTER TABLE contacts` then fails with
-- `42P01: relation "contacts" does not exist` even though the table is
-- right there. Qualifying also matters when cloning this CRM: the script
-- has to behave identically on every client's project, whatever the
-- session default happens to be.
--
-- Prerequisite: migrations 001-042 must already be applied.
-- ============================================================

SET search_path = public, extensions, pg_catalog;

-- ------------------------------------------------------------
-- 1. The click id that makes ad attribution possible.
--
-- Meta's referral payload carries `ctwa_clid` on the FIRST message a
-- customer sends after clicking a Click-to-WhatsApp ad. It is the only
-- thing that ties a later purchase back to the ad that produced it —
-- without it the Conversions API accepts the event but attributes it to
-- nothing. It arrives on every ad-originated message and was previously
-- parsed and discarded.
-- ------------------------------------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS acquisition_ctwa_clid TEXT;

-- ------------------------------------------------------------
-- 2. Per-account Meta Conversions API credentials.
--
-- Mirrors `ai_configs`: account-scoped, UNIQUE(account_id), token
-- AES-256-GCM-encrypted at rest and never returned to the client.
--
--   dataset_id       Events Manager dataset (formerly "pixel") that
--                    receives the events.
--   access_token     Generated on that dataset's Conversions API tab.
--   waba_id          WhatsApp Business Account id. Required by Meta in
--                    `user_data` for the whatsapp messaging channel, and
--                    NOT derivable here: unofficial providers (uazapi,
--                    Evolution) never see it, so `whatsapp_config.waba_id`
--                    is null on those deployments and the operator has to
--                    copy it from Business Manager.
--   test_event_code  Optional. Routes events to the Test Events tab in
--                    Events Manager instead of counting as real
--                    conversions — how a new deployment is verified
--                    without polluting live ad optimisation.
--   send_qualified_lead / send_purchase
--                    Independent switches. `Purchase` is the expensive
--                    signal: a wrong one teaches Meta to spend budget
--                    chasing the wrong audience for weeks, so an operator
--                    may reasonably want lead events automated while
--                    purchases stay manual.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_capi_configs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dataset_id          text NOT NULL,
  access_token        text NOT NULL,          -- AES-256-GCM encrypted
  waba_id             text,
  test_event_code     text,
  is_active           boolean NOT NULL DEFAULT false,
  send_qualified_lead boolean NOT NULL DEFAULT true,
  send_purchase       boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_capi_configs ENABLE ROW LEVEL SECURITY;

-- Settings-class RLS, split per verb exactly like ai_configs (029): any
-- member may read (the Setup page reports whether it is configured),
-- admin+ only may write. The sender runs under the service-role client
-- from a webhook, where there is no auth.uid(), so these guard dashboard
-- access rather than the engine.
DROP POLICY IF EXISTS meta_capi_configs_select ON public.meta_capi_configs;
CREATE POLICY meta_capi_configs_select ON public.meta_capi_configs FOR SELECT
  USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS meta_capi_configs_insert ON public.meta_capi_configs;
CREATE POLICY meta_capi_configs_insert ON public.meta_capi_configs FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_capi_configs_update ON public.meta_capi_configs;
CREATE POLICY meta_capi_configs_update ON public.meta_capi_configs FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_capi_configs_delete ON public.meta_capi_configs;
CREATE POLICY meta_capi_configs_delete ON public.meta_capi_configs FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON public.meta_capi_configs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.meta_capi_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- 3. Sent-event ledger — the idempotency guard.
--
-- A deal can cross into "qualified" many times (a human drags the card
-- back, the classifier re-runs, a card is reopened). Each duplicate
-- conversion inflates the ad account's reported results and corrupts
-- optimisation, so UNIQUE(deal_id, event_name) makes a second send
-- impossible rather than merely unlikely.
--
-- Failures are recorded too: a row with status='failed' is a breadcrumb
-- for "why did this deal never reach Meta", which is otherwise invisible.
-- `event_id` is the idempotency key echoed to Meta, which dedupes on it
-- as a second line of defence.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_capi_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  deal_id       uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  contact_id    uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  event_name    text NOT NULL CHECK (event_name IN ('QualifiedLead', 'Purchase')),
  event_id      text NOT NULL,
  value         numeric,
  currency      text,
  status        text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Partial unique index rather than a table constraint: a failed attempt
-- must not permanently block a later retry, so only successful sends
-- occupy the (deal, event) slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_capi_events_sent
  ON public.meta_capi_events(deal_id, event_name) WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS idx_meta_capi_events_account
  ON public.meta_capi_events(account_id, created_at DESC);

ALTER TABLE public.meta_capi_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_capi_events_select ON public.meta_capi_events;
CREATE POLICY meta_capi_events_select ON public.meta_capi_events FOR SELECT
  USING (public.is_account_member(account_id));
-- No INSERT/UPDATE/DELETE policy: the ledger is written by the
-- service-role sender only, never from the browser.

-- ------------------------------------------------------------
-- 4. Business configuration that used to live in the environment.
--
-- `deal_product_scope` was the env var DEAL_PRODUCT_SCOPE. It describes
-- what the shop sells and is the single biggest thing that differs
-- between customers — a phone reseller and a furniture shop cannot share
-- one value, and an env var cannot vary per account.
--
-- The three stage columns replace matching stage NAMES against a
-- hardcoded Portuguese list. Name matching breaks silently the moment a
-- customer renames a column, and it cannot work at all for a customer
-- whose board is in another language. Storing the ids lets the Setup UI
-- offer a dropdown of the board that actually exists. Null falls back to
-- the old name matching, so existing deployments keep working untouched.
-- ------------------------------------------------------------
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS deal_product_scope TEXT,
  ADD COLUMN IF NOT EXISTS deal_stage_qualified_id  uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_stage_negotiating_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_stage_closed_id      uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;
