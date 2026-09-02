-- 068: This CRM operates exclusively in Brazilian reais.
-- Normalize historical rows and enforce BRL for every future account/deal.

ALTER TABLE public.accounts
  ALTER COLUMN default_currency SET DEFAULT 'BRL';

UPDATE public.accounts
SET default_currency = 'BRL'
WHERE default_currency IS DISTINCT FROM 'BRL';

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_default_currency_format;
ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_default_currency_brl_only;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_default_currency_brl_only
  CHECK (default_currency = 'BRL');

ALTER TABLE public.deals
  ALTER COLUMN currency SET DEFAULT 'BRL';

UPDATE public.deals
SET currency = 'BRL'
WHERE currency IS DISTINCT FROM 'BRL';

ALTER TABLE public.deals
  ALTER COLUMN currency SET NOT NULL;

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_currency_brl_only;
ALTER TABLE public.deals
  ADD CONSTRAINT deals_currency_brl_only
  CHECK (currency = 'BRL');

UPDATE public.meta_capi_events
SET currency = 'BRL'
WHERE currency IS NOT NULL AND currency IS DISTINCT FROM 'BRL';

ALTER TABLE public.meta_capi_events
  DROP CONSTRAINT IF EXISTS meta_capi_events_currency_brl_only;
ALTER TABLE public.meta_capi_events
  ADD CONSTRAINT meta_capi_events_currency_brl_only
  CHECK (currency IS NULL OR currency = 'BRL');
