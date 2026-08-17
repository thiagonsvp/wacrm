SET search_path = public, extensions, pg_catalog;

ALTER TABLE public.windsor_configs
  ADD COLUMN IF NOT EXISTS meta_ads_account_id text,
  ADD COLUMN IF NOT EXISTS meta_ads_account_name text,
  ADD COLUMN IF NOT EXISTS google_ads_account_id text,
  ADD COLUMN IF NOT EXISTS google_ads_account_name text;
