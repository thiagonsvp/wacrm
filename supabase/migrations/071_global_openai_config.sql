-- ============================================================
-- 071: one OpenAI key and model for the whole deployment.
--
-- Agent prompts, toggles and routing remain account-scoped in
-- ai_configs. Only provider credentials are centralized here.
-- ============================================================
SET search_path = public, extensions, pg_catalog;

CREATE TABLE IF NOT EXISTS public.ai_global_config (
  singleton       boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  provider        text NOT NULL DEFAULT 'openai' CHECK (provider = 'openai'),
  model           text NOT NULL,
  api_key         text NOT NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_global_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_global_config_select ON public.ai_global_config;
CREATE POLICY ai_global_config_select ON public.ai_global_config FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.is_super_admin
  ));

DROP POLICY IF EXISTS ai_global_config_insert ON public.ai_global_config;
CREATE POLICY ai_global_config_insert ON public.ai_global_config FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.is_super_admin
  ));

DROP POLICY IF EXISTS ai_global_config_update ON public.ai_global_config;
CREATE POLICY ai_global_config_update ON public.ai_global_config FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.is_super_admin
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.is_super_admin
  ));

DROP TRIGGER IF EXISTS set_updated_at ON public.ai_global_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.ai_global_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
