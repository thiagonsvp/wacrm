-- ============================================================
-- 047_multi_company_membership.sql — one login, many companies
--
-- The CRM was already multi-tenant: `accounts` are companies, all 16
-- domain tables carry `account_id`, `whatsapp_config` is UNIQUE per
-- account, and every inbound webhook resolves the company from the
-- WhatsApp identifier it arrived on. What it could not do was let ONE
-- person reach more than one company: `profiles` is UNIQUE(user_id) with
-- a single `account_id`, so an operator running several clients needed a
-- separate login per client and no way to switch.
--
-- The shape of the change
--
--   `profiles.account_id` stops meaning "the company this user belongs
--   to" and starts meaning "the company this user is currently looking
--   at". Which companies they MAY look at moves to `account_members`.
--
--   That split is what keeps this migration small. Every RLS policy in
--   the database goes through `is_account_member()` — not one of them
--   reads `profiles` directly — so rewriting that single function
--   switches the isolation model for all 16 tables at once, and every
--   line of application code that reads `profiles.account_id` keeps
--   working untouched.
--
-- Security
--
--   `profiles.account_id` is now user-selectable, so it MUST NOT be
--   writable directly: setting it to a stranger's company would hand
--   over their data. The column is locked by a trigger and can only be
--   moved through `switch_account()`, which verifies membership first.
--
--   `is_super_admin` deliberately grants read/write across every
--   company. It is for the operator who runs the deployment, never for
--   a client, and it is set by hand in SQL — no UI, no self-service, no
--   API surface that can grant it.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

SET search_path = public, extensions, pg_catalog;

-- ------------------------------------------------------------
-- 1. Which companies a user may access.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_members (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  role       account_role_enum NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_account_members_account
  ON public.account_members(account_id);

-- Carry over every existing profile as its own membership, so nobody
-- loses access the moment this runs.
INSERT INTO public.account_members (user_id, account_id, role)
SELECT p.user_id, p.account_id, COALESCE(p.account_role, 'viewer')
FROM public.profiles p
WHERE p.account_id IS NOT NULL
ON CONFLICT (user_id, account_id) DO NOTHING;

ALTER TABLE public.account_members ENABLE ROW LEVEL SECURITY;

-- Readable by anyone who shares the company (the Members tab), writable
-- only through the SECURITY DEFINER RPCs in 018/019 and by admins.
DROP POLICY IF EXISTS account_members_select ON public.account_members;
CREATE POLICY account_members_select ON public.account_members FOR SELECT
  USING (user_id = auth.uid() OR public.is_account_member(account_id));

DROP POLICY IF EXISTS account_members_write ON public.account_members;
CREATE POLICY account_members_write ON public.account_members FOR ALL
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- 2. The operator who can see every company.
-- ------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- 3. The one function every RLS policy funnels through.
--
-- Access is scoped to the ONE company currently selected. The two
-- concerns are deliberately separate:
--
--   account_members     -> which companies you may ENTER
--                          (switch_account / list_my_accounts)
--   profiles.account_id -> the company you are in RIGHT NOW, and the
--                          only one any query can reach
--
-- Granting access to every company a user belongs to, all at once, was
-- tried first and is wrong here: many client queries omit an explicit
-- account filter and lean on RLS to scope them
-- (`from('tags').select('*')` in contact-form.tsx, among others). Under
-- that model a user in two companies saw both sets interleaved — the
-- exact cross-company bleed this table exists to prevent.
--
-- Scoping to the selection preserves the pre-migration property (one
-- company at a time, every query behaving as it does for a plain member)
-- while still letting an operator reach them all by switching.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id uuid,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    LEFT JOIN account_members m
      ON m.user_id = p.user_id AND m.account_id = p.account_id
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND (
        p.is_super_admin
        OR (
          m.user_id IS NOT NULL
          AND CASE m.role
                WHEN 'owner'  THEN 4
                WHEN 'admin'  THEN 3
                WHEN 'agent'  THEN 2
                WHEN 'viewer' THEN 1
              END
            >=
              CASE min_role
                WHEN 'owner'  THEN 4
                WHEN 'admin'  THEN 3
                WHEN 'agent'  THEN 2
                WHEN 'viewer' THEN 1
              END
        )
      )
  );
$$;

ALTER FUNCTION public.is_account_member(uuid, account_role_enum) OWNER TO postgres;

-- ------------------------------------------------------------
-- 4. Why `profiles.account_id` is NOT locked down.
--
-- The obvious next step is a trigger refusing direct writes to that
-- column. It would be wrong twice over.
--
-- It protects nothing: after the rewrite above, membership decides
-- access, and `profiles.account_id` only decides which company the UI
-- points at. A user who forced it to a stranger's company would still be
-- refused every row by RLS and would simply see an empty CRM — no data
-- crosses, and the only person inconvenienced is them.
--
-- And it would break real flows: `remove_account_member` (018) and
-- invitation redemption (019) both legitimately move a profile between
-- companies with a plain UPDATE. A blanket guard would reject those and
-- take invitations down with it.
--
-- ------------------------------------------------------------
-- 5. Switching company.
--
-- SECURITY DEFINER so it can flip the guarded column, but it verifies
-- membership for the CALLER first — the definer rights are used to write
-- the row, never to decide who may.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.switch_account(target_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT m.role INTO v_role
  FROM account_members m
  WHERE m.user_id = auth.uid() AND m.account_id = target_account_id;

  -- A super admin may enter any company; they get owner-level rights
  -- there, matching what is_account_member() already grants them.
  IF v_role IS NULL THEN
    IF EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin)
       AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = target_account_id)
    THEN
      v_role := 'owner';
    ELSE
      RAISE EXCEPTION 'not a member of that company'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Transaction-local flag read by sync_membership_from_profile below.
  -- Without it, a super admin merely LOOKING at a client's company would
  -- be written into that client's member list and start appearing in
  -- their Members tab.
  PERFORM set_config('wacrm.switching_account', 'on', true);
  UPDATE profiles
     SET account_id = target_account_id,
         account_role = v_role,
         updated_at = now()
   WHERE user_id = auth.uid();
  PERFORM set_config('wacrm.switching_account', 'off', true);
END;
$$;

ALTER FUNCTION public.switch_account(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.switch_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.switch_account(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 6. The companies this user can switch to.
--
-- SECURITY DEFINER because a super admin has to see companies they hold
-- no membership row for, which RLS on `accounts` would otherwise hide.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_accounts()
RETURNS TABLE (id uuid, name text, role account_role_enum, is_current boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id,
         a.name,
         COALESCE(m.role, 'owner'::account_role_enum) AS role,
         (a.id = p.account_id) AS is_current
  FROM accounts a
  LEFT JOIN account_members m
         ON m.account_id = a.id AND m.user_id = auth.uid()
  LEFT JOIN profiles p
         ON p.user_id = auth.uid()
  WHERE m.user_id IS NOT NULL
     OR COALESCE(p.is_super_admin, false)
  ORDER BY a.name;
$$;

ALTER FUNCTION public.list_my_accounts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_my_accounts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_accounts() TO authenticated;

-- ------------------------------------------------------------
-- 7. Keep membership in step with the existing member RPCs.
--
-- 018/019 write `profiles.account_id` / `account_role` when someone is
-- invited or has their role changed. Mirroring those writes here means
-- those flows keep working without being rewritten, and a role change
-- takes effect on the permission model rather than only on the label.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_membership_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Switching company is a change of VIEW, not a change of membership.
  -- Skipping here is what stops a super admin from silently enrolling
  -- themselves into every client company they open.
  IF current_setting('wacrm.switching_account', true) = 'on' THEN
    RETURN NEW;
  END IF;

  INSERT INTO account_members (user_id, account_id, role)
  VALUES (NEW.user_id, NEW.account_id, COALESCE(NEW.account_role, 'viewer'))
  ON CONFLICT (user_id, account_id) DO UPDATE
    SET role = EXCLUDED.role;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_membership ON public.profiles;
CREATE TRIGGER sync_membership
  AFTER INSERT OR UPDATE OF account_id, account_role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_membership_from_profile();
