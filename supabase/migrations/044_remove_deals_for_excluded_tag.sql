-- ============================================================
-- 044_remove_deals_for_excluded_tag.sql
--
-- Tagging a contact as a supplier (or anything else that is not a
-- customer) takes their card off the sales board immediately.
--
-- Why a database trigger
--
--   The application already refuses to CREATE cards for excluded
--   contacts, and clears an existing card the next time such a contact
--   messages. That is not enough on its own: tagging almost always
--   happens *after* the classifier has filed someone — the operator
--   spots a supplier in the pipeline and reaches for the tag — and a
--   supplier who then goes quiet for weeks leaves their card sitting
--   there the whole time.
--
--   Tags are written straight from the browser (contact detail, contact
--   form, CSV import) and also by the automations engine, so there is no
--   single server route to hook. The trigger is the one place that
--   catches every path.
--
-- Safety
--
--   SECURITY INVOKER (the default) — deliberately NOT definer. The
--   `deals` RLS is account-scoped (`is_account_member(account_id,
--   'agent')`), so an agent tagging a contact already has the right to
--   delete that account's cards; the trigger needs no extra privilege
--   and cannot be turned into one. The delete is further confined to the
--   single contact whose tag row was just inserted, and that insert had
--   to pass `contact_tags` RLS to happen at all.
--
--   Self-healing: removing the tag lets the classifier file the contact
--   again on their next message, so a mis-tag costs one message rather
--   than being unrecoverable.
--
-- Keep in sync with DEAL_PIPELINE_EXCLUDED_TAGS in the application
-- (src/lib/ai/deal-pipeline.ts). The two are separate on purpose — the
-- app must not need a database round-trip to know whether to skip a
-- classification — but they describe the same policy, so a change to one
-- belongs in the other.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

SET search_path = public, extensions, pg_catalog;

CREATE OR REPLACE FUNCTION public.remove_deals_for_excluded_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  tag_name text;
BEGIN
  SELECT btrim(lower(t.name)) INTO tag_name
  FROM public.tags t
  WHERE t.id = NEW.tag_id;

  IF tag_name IS NULL THEN
    RETURN NEW;
  END IF;

  -- Names are compared lowercased and trimmed because they are typed by
  -- hand. Neither of these carries an accent, so no unaccent extension
  -- is required.
  IF tag_name = ANY (ARRAY['fornecedor', 'outros']) THEN
    DELETE FROM public.deals WHERE contact_id = NEW.contact_id;
  END IF;

  RETURN NEW;
END;
$$;

-- AFTER INSERT: the tag link is already committed, so the board and the
-- tag list can never disagree if the delete fails.
DROP TRIGGER IF EXISTS remove_deals_on_excluded_tag ON public.contact_tags;
CREATE TRIGGER remove_deals_on_excluded_tag
  AFTER INSERT ON public.contact_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.remove_deals_for_excluded_tag();
