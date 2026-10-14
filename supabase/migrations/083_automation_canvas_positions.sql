-- Canvas positions for the automation builder (draggable React Flow
-- canvas, like the Flows builder).
--
-- Stored on each automation_steps row rather than as a map on the
-- automation: replaceSteps() deletes and re-inserts every step on each
-- save with fresh ids, so a map keyed by step id would go stale on every
-- save. A position that travels with its row needs no key at all.
--
-- NULL means "never placed" — the builder auto-lays those out. The
-- trigger is not a step row, so its position lives on the automation.
--
-- Purely presentational: the engine never reads these columns.
-- Idempotent — safe to re-run.

ALTER TABLE public.automation_steps
  ADD COLUMN IF NOT EXISTS position_x integer,
  ADD COLUMN IF NOT EXISTS position_y integer;

ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS canvas_trigger_position jsonb;
