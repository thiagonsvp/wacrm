-- ============================================================
-- 070: one Windsor credential for the whole deployment.
--
-- Company rows keep only the selected Meta / Google account. The API
-- key and dashboard URL live in this singleton and are editable only by
-- the platform operator (profiles.is_super_admin).
-- ============================================================
SET search_path = public, extensions, pg_catalog;

CREATE TABLE IF NOT EXISTS public.windsor_global_config (
  singleton       boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  api_key         text,
  dashboard_url   text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.windsor_global_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS windsor_global_config_select ON public.windsor_global_config;
CREATE POLICY windsor_global_config_select ON public.windsor_global_config FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.is_super_admin
  ));

DROP POLICY IF EXISTS windsor_global_config_insert ON public.windsor_global_config;
CREATE POLICY windsor_global_config_insert ON public.windsor_global_config FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.is_super_admin
  ));

DROP POLICY IF EXISTS windsor_global_config_update ON public.windsor_global_config;
CREATE POLICY windsor_global_config_update ON public.windsor_global_config FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.is_super_admin
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.is_super_admin
  ));

DROP TRIGGER IF EXISTS set_updated_at ON public.windsor_global_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.windsor_global_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
