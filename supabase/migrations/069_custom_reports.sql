-- ============================================================
-- 069: reusable, prompt-driven CRM reports.
--
-- A report definition belongs to one account. Its latest generated
-- result is kept with the prompt so opening a saved report restores the
-- last useful view immediately; regenerating replaces only that result.
-- ============================================================
SET search_path = public, extensions, pg_catalog;

CREATE TABLE IF NOT EXISTS public.custom_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  prompt            text NOT NULL CHECK (char_length(prompt) BETWEEN 10 AND 4000),
  last_result       text,
  last_generated_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_reports_account_updated
  ON public.custom_reports(account_id, updated_at DESC);

ALTER TABLE public.custom_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_reports_select ON public.custom_reports;
CREATE POLICY custom_reports_select ON public.custom_reports FOR SELECT
  USING (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS custom_reports_insert ON public.custom_reports;
CREATE POLICY custom_reports_insert ON public.custom_reports FOR INSERT
  WITH CHECK (
    public.is_account_member(account_id, 'agent')
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS custom_reports_update ON public.custom_reports;
CREATE POLICY custom_reports_update ON public.custom_reports FOR UPDATE
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS custom_reports_delete ON public.custom_reports;
CREATE POLICY custom_reports_delete ON public.custom_reports FOR DELETE
  USING (public.is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON public.custom_reports;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.custom_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
