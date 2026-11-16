-- 088_security_hardening.sql
--
-- Security audit fixes (2026-11-16).
--
-- 1. profiles.is_super_admin was self-writable: the profiles_update policy
--    only checks auth.uid() = user_id and the privilege trigger (034) only
--    guarded account_role / account_id. Any logged-in user could PATCH
--    is_super_admin = true and gain cross-tenant access. The trigger now
--    also guards is_super_admin, and also runs on INSERT.
--
-- 2. Tables created without RLS were readable/writable through PostgREST
--    with the public anon key: whatsapp_webhook_debug (raw inbound payloads
--    of every tenant) and two ad-hoc backups created outside migrations.
--    They are locked to service_role only. Data is kept; drop them later
--    if they are no longer needed.
--
-- 3. SECURITY DEFINER functions keep Supabase's default EXECUTE grant to
--    anon/authenticated (REVOKE ... FROM PUBLIC does not remove it). Internal
--    ones (server/trigger only) are revoked from both roles; user-facing
--    RPCs are revoked from anon only. is_account_member,
--    is_platform_super_admin and peek_invitation stay callable by anon:
--    the first two are evaluated inside RLS policies declared TO public,
--    and peek_invitation backs the pre-login invitation page.

-- ---------------------------------------------------------------------
-- 1. Privilege columns on profiles
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_super_admin := false;
    RETURN NEW;
  END IF;

  IF NEW.account_role IS DISTINCT FROM OLD.account_role
     OR NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION
      'account_role and account_id cannot be changed directly; use the account member/invitation RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    RAISE EXCEPTION 'is_super_admin cannot be changed by users'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_profile_privilege_columns ON public.profiles;
CREATE TRIGGER enforce_profile_privilege_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_privilege_columns();

-- ---------------------------------------------------------------------
-- 2. Lock tables that had no RLS
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'whatsapp_webhook_debug',
    'whatsapp_config_backup_20260806',
    'deals_backup_boleto_20260813'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. SECURITY DEFINER function grants
-- ---------------------------------------------------------------------

-- Internal: called only by server code (service_role) or by triggers.
REVOKE ALL ON FUNCTION public._bcast_bump(uuid, text, integer)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_broadcast_counts(uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_duplicate_contacts()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_webhook_failure(uuid, integer)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_ai_reply_slot(uuid, integer)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_system_task_change()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_system_task_comment()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_recipient_aggregate_trigger()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user()                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_conversation_assigned()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_membership_from_profile()              FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._bcast_bump(uuid, text, integer)         TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_broadcast_counts(uuid)         TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_contacts()               TO service_role;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(uuid, integer)    TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer)       TO service_role;

-- User-facing RPCs: logged-in users only.
REVOKE ALL ON FUNCTION public.create_company(text)                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_my_accounts()                                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_invitation(text)                               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_account_member(uuid)                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_member_role(uuid, public.account_role_enum)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.switch_account(uuid)                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.touch_presence(text)                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_account_ownership(uuid)                      FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_company(text)                               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_accounts()                                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text)                            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_account_member(uuid)                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, public.account_role_enum)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.switch_account(uuid)                               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.touch_presence(text)                               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(uuid)                   TO authenticated, service_role;
