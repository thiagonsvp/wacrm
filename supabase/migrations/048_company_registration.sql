-- ============================================================
-- 048_company_registration.sql — register a company from the app
--
-- Until now an `accounts` row could only appear as a side effect of a
-- signup: `handle_new_user()` creates one named after the person's
-- full_name. That is why the company list reads as a list of people
-- ("Thiago Nascimento da Silva", "Saulo Magalhaes") and why there was
-- nowhere to state what the business is actually called. A rename API
-- has existed since 017 but nothing in the UI ever called it.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

SET search_path = public, extensions, pg_catalog;

-- ------------------------------------------------------------
-- 1. One owner may hold several companies.
--
-- 017 created `idx_accounts_one_per_owner` and said so plainly: "One
-- account per user (the locked design decision — single membership).
-- Drops automatically if we ever relax to many-to-many." 047 did exactly
-- that, so this is the anticipated follow-through rather than a
-- workaround.
--
-- Without dropping it, create_company() fails on the SECOND company an
-- operator registers: `accounts.owner_user_id` is NOT NULL, so every
-- company they create names them owner and the index refuses it.
--
-- Uniqueness is relocated, not lost: `account_members` enforces one row
-- per (user, company) and is what the permission model actually reads.
-- `owner_user_id` remains the record of who created a company and what
-- ON DELETE RESTRICT protects it from.
-- ------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_accounts_one_per_owner;

-- ------------------------------------------------------------
-- 2. Registering a company.
--
-- Restricted to super admins. Company creation is an operator action:
-- letting any signed-in user mint accounts would strew orphans (this
-- deployment already carries one with zero users) and hand out a lever
-- on the tenancy model that nothing else in the app needs.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_company(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id   uuid;
  v_name text := btrim(p_name);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin
  ) THEN
    RAISE EXCEPTION 'only a super admin can create a company'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'company name is required' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_name) > 80 THEN
    RAISE EXCEPTION 'company name is too long' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (v_name, auth.uid())
  RETURNING id INTO v_id;

  -- The creator becomes a real member, not merely a super admin passing
  -- through: the company needs an owner who remains after the operator
  -- hands it over, and switch_account() should work without leaning on
  -- the super-admin path.
  INSERT INTO account_members (user_id, account_id, role)
  VALUES (auth.uid(), v_id, 'owner')
  ON CONFLICT (user_id, account_id) DO NOTHING;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.create_company(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_company(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_company(text) TO authenticated;
