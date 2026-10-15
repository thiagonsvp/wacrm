-- ============================================================
-- 086: guard direct writes to account_members
--
-- Migration 047 made account_members writable by any admin of the
-- company under RLS (account_members_write). That is what lets the
-- Members tab manage a teammate who has another company open, but it
-- also let an admin call the table straight from the browser and:
--   * set their own membership to 'owner' (then switch_account into it),
--   * promote someone else to owner, or demote / remove the owner,
-- skipping every rule the 018 RPCs enforce.
--
-- The legitimate paths that touch 'owner' or one's own row all run as
-- SECURITY DEFINER functions (switch_account, transfer_account_ownership,
-- the sync_membership trigger fed by set_member_role / invitations), so
-- they execute as the function owner, not as `authenticated`. Only a
-- direct client write runs as `authenticated` — that is what is blocked.
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_account_members_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own membership' USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own membership' USING ERRCODE = '42501';
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to change the owner'
      USING ERRCODE = '22023';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  -- A membership never moves to another company or person.
  IF TG_OP = 'UPDATE'
     AND (NEW.account_id <> OLD.account_id OR NEW.user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'A membership cannot be moved' USING ERRCODE = '22023';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS guard_account_members_write ON public.account_members;
CREATE TRIGGER guard_account_members_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.account_members
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_account_members_write();
