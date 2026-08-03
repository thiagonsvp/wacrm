-- ============================================================
-- 045_closed_deals_land_in_closed_stage.sql
--
-- A deal marked won or lost always sits in the closed stage.
--
-- Why a trigger rather than application code
--
--   A deal reaches "won" or "lost" from four different places: the AI
--   classifier, the two buttons in the deal form, a drag on the board,
--   and the public API. Enforcing "and now move it" in each of them is
--   four chances to disagree, and the board is where the operator forms
--   their picture of the funnel — a won deal left sitting in Negociação
--   makes that picture wrong. One trigger cannot be bypassed.
--
-- Resolving the closed stage
--
--   Prefers `ai_configs.deal_stage_closed_id` when the operator picked
--   it in Settings. Falls back to matching the stage NAME inside the
--   deal's own pipeline, so a deployment that never configured it (and
--   any board in another language that happens to use one of these
--   names) still works. If neither resolves, the stage is left alone
--   rather than guessed — a write must never fail because the board is
--   half-built.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

SET search_path = public, extensions, pg_catalog;

CREATE OR REPLACE FUNCTION public.deal_closed_lands_in_closed_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_stage uuid;
BEGIN
  IF NEW.status NOT IN ('won', 'lost') THEN
    RETURN NEW;
  END IF;

  -- Operator's explicit choice wins, but only if that stage really
  -- belongs to this deal's pipeline — otherwise the card would jump to
  -- another board.
  SELECT c.deal_stage_closed_id INTO v_stage
  FROM public.ai_configs c
  WHERE c.account_id = NEW.account_id
    AND c.deal_stage_closed_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.pipeline_stages s
      WHERE s.id = c.deal_stage_closed_id AND s.pipeline_id = NEW.pipeline_id
    );

  IF v_stage IS NULL THEN
    SELECT s.id INTO v_stage
    FROM public.pipeline_stages s
    WHERE s.pipeline_id = NEW.pipeline_id
      AND btrim(lower(s.name)) = ANY (
        ARRAY['finalizado', 'fechado', 'concluido', 'ganho', 'closed', 'won']
      )
    ORDER BY s.position DESC
    LIMIT 1;
  END IF;

  IF v_stage IS NOT NULL THEN
    NEW.stage_id := v_stage;
  END IF;

  RETURN NEW;
END;
$$;

-- BEFORE, so the row is written once with the right stage instead of
-- being updated a second time by an AFTER trigger (which would also
-- fire this one again).
DROP TRIGGER IF EXISTS deal_closed_stage ON public.deals;
CREATE TRIGGER deal_closed_stage
  BEFORE INSERT OR UPDATE OF status, stage_id, pipeline_id ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.deal_closed_lands_in_closed_stage();
