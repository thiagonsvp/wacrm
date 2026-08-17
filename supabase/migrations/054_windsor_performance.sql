SET search_path = public, extensions, pg_catalog;

CREATE TABLE IF NOT EXISTS public.windsor_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  meta_ads_url text,
  google_ads_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.windsor_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS windsor_configs_select ON public.windsor_configs;
CREATE POLICY windsor_configs_select ON public.windsor_configs FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS windsor_configs_insert ON public.windsor_configs;
CREATE POLICY windsor_configs_insert ON public.windsor_configs FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS windsor_configs_update ON public.windsor_configs;
CREATE POLICY windsor_configs_update ON public.windsor_configs FOR UPDATE USING (public.is_account_member(account_id, 'admin'));
DROP TRIGGER IF EXISTS set_updated_at ON public.windsor_configs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.windsor_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
