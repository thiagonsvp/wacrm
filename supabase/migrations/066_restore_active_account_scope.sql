-- A membership lets a user switch companies; it must not expose all of
-- them at once. Restore the selected-profile account boundary while keeping
-- the active-company check introduced by migration 064.
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
