-- The "Gerente" tier.
--
-- The account roles were owner > admin > agent > viewer. A sales
-- operation needs a step between "runs the whole system" and "answers
-- customers": someone who leads the floor — reviews conversions, sends
-- broadcasts, manages tags and quick replies — but does not touch
-- integrations, API keys, AI configuration or billing.
--
-- Privilege never comes from the enum's sort order — `is_account_member`
-- ranks the labels explicitly (owner 5, admin 4, manager 3, agent 2,
-- viewer 1) and that CASE is the only authority. The physical position of
-- the new label is therefore cosmetic; do not read the enum order as a
-- hierarchy. Existing rows are untouched: nobody becomes a manager by
-- accident.
--
-- Note on scope: this migration governs WHAT A ROLE MAY DO. It
-- deliberately does not restrict WHICH ROWS a role may see — every member
-- of a company still sees all of that company's contacts and deals, which
-- is the behaviour the operator asked for. If per-seller visibility is
-- ever wanted, it belongs in the RLS row filters, not here.

SET search_path = public, extensions, pg_catalog;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'account_role_enum' AND e.enumlabel = 'manager'
  ) THEN
    ALTER TYPE account_role_enum ADD VALUE 'manager' BEFORE 'admin';
  END IF;
END $$;

-- Re-rank so 'manager' sits between agent and admin. This is the single
-- authority for privilege comparisons; the TypeScript mirror lives in
-- src/lib/auth/roles.ts and must stay in step with it.
CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id uuid,
  min_role account_role_enum DEFAULT 'viewer'::account_role_enum
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
                WHEN 'owner' THEN 5 WHEN 'admin' THEN 4
                WHEN 'manager' THEN 3 WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
            >= CASE min_role
                WHEN 'owner' THEN 5 WHEN 'admin' THEN 4
                WHEN 'manager' THEN 3 WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
        )
      )
  );
$function$;
