SET search_path = public, extensions, pg_catalog;

UPDATE public.deals
SET expected_close_date = COALESCE(updated_at::date, created_at::date)
WHERE status = 'won' AND expected_close_date IS NULL;

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_won_requires_close_date;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_won_requires_close_date
  CHECK (status <> 'won' OR expected_close_date IS NOT NULL);
