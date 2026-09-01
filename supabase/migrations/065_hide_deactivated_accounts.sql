-- Keep deactivation compatible with the multi-company membership model.
-- The previous helper used the pre-membership role shape; this version is
-- based on migration 053 (which includes the manager role) and also checks
-- that the selected company is active.
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
    FROM public.profiles p
    JOIN public.accounts a ON a.id = target_account_id AND a.is_active = true
    LEFT JOIN public.account_members m
      ON m.user_id = p.user_id AND m.account_id = target_account_id
    WHERE p.user_id = auth.uid()
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

-- A disabled company is neither offered in the picker nor accepted as a
-- switch target, even if the caller still has a membership record.
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
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.id = target_account_id AND a.is_active = true
  ) THEN
    RAISE EXCEPTION 'company is deactivated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT m.role INTO v_role
  FROM public.account_members m
  WHERE m.user_id = auth.uid() AND m.account_id = target_account_id;

  IF v_role IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin) THEN
      v_role := 'owner';
    ELSE
      RAISE EXCEPTION 'not a member of that company' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  PERFORM set_config('wacrm.switching_account', 'on', true);
  UPDATE public.profiles
     SET account_id = target_account_id,
         account_role = v_role,
         updated_at = now()
   WHERE user_id = auth.uid();
  PERFORM set_config('wacrm.switching_account', 'off', true);
END;
$$;

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
  FROM public.accounts a
  LEFT JOIN public.account_members m
         ON m.account_id = a.id AND m.user_id = auth.uid()
  LEFT JOIN public.profiles p
         ON p.user_id = auth.uid()
  WHERE a.is_active = true
    AND (m.user_id IS NOT NULL OR COALESCE(p.is_super_admin, false))
  ORDER BY a.name;
$$;
