-- ============================================================
-- 072: deployment-wide improvement and release planning board.
-- Only platform super administrators can read or mutate these rows.
-- ============================================================
SET search_path = public, extensions, pg_catalog;

CREATE TABLE IF NOT EXISTS public.system_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text,
  acceptance_criteria text,
  status text NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','planned','in_progress','validation','completed','cancelled')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  task_type text NOT NULL DEFAULT 'improvement' CHECK (task_type IN ('improvement','bug','feature','maintenance')),
  module text,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  due_date date,
  effort text CHECK (effort IS NULL OR effort IN ('xs','s','m','l','xl')),
  position integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.system_tasks(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_task_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.system_tasks(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created','updated','status_changed','commented')),
  field text,
  old_value text,
  new_value text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_tasks_status_position_idx ON public.system_tasks(status, position, updated_at DESC);
CREATE INDEX IF NOT EXISTS system_tasks_due_date_idx ON public.system_tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS system_tasks_account_idx ON public.system_tasks(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS system_task_comments_task_idx ON public.system_task_comments(task_id, created_at);
CREATE INDEX IF NOT EXISTS system_task_history_task_idx ON public.system_task_history(task_id, created_at DESC);

ALTER TABLE public.system_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_task_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_platform_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_super_admin = true) $$;

REVOKE ALL ON FUNCTION public.is_platform_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_super_admin() TO authenticated;

DROP POLICY IF EXISTS system_tasks_super_admin_all ON public.system_tasks;
CREATE POLICY system_tasks_super_admin_all ON public.system_tasks FOR ALL
  USING (public.is_platform_super_admin()) WITH CHECK (public.is_platform_super_admin());
DROP POLICY IF EXISTS system_task_comments_super_admin_all ON public.system_task_comments;
CREATE POLICY system_task_comments_super_admin_all ON public.system_task_comments FOR ALL
  USING (public.is_platform_super_admin()) WITH CHECK (public.is_platform_super_admin());
DROP POLICY IF EXISTS system_task_history_super_admin_all ON public.system_task_history;
CREATE POLICY system_task_history_super_admin_all ON public.system_task_history FOR ALL
  USING (public.is_platform_super_admin()) WITH CHECK (public.is_platform_super_admin());

DROP TRIGGER IF EXISTS set_updated_at ON public.system_tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.system_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.audit_system_task_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  watched text;
  before_value text;
  after_value text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.system_task_history(task_id, action, new_value, created_by)
    VALUES (NEW.id, 'created', NEW.title, NEW.created_by);
    RETURN NEW;
  END IF;

  FOREACH watched IN ARRAY ARRAY['title','description','acceptance_criteria','status','priority','task_type','module','account_id','due_date','effort','position'] LOOP
    before_value := to_jsonb(OLD) ->> watched;
    after_value := to_jsonb(NEW) ->> watched;
    IF before_value IS DISTINCT FROM after_value THEN
      INSERT INTO public.system_task_history(task_id, action, field, old_value, new_value, created_by)
      VALUES (
        NEW.id,
        CASE WHEN watched = 'status' THEN 'status_changed' ELSE 'updated' END,
        watched,
        before_value,
        after_value,
        COALESCE(NEW.updated_by, NEW.created_by)
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_system_task_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.system_task_history(task_id, action, new_value, created_by)
  VALUES (NEW.task_id, 'commented', left(NEW.body, 200), NEW.created_by);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_system_task_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_system_task_comment() FROM PUBLIC;

DROP TRIGGER IF EXISTS audit_system_task_change ON public.system_tasks;
CREATE TRIGGER audit_system_task_change AFTER INSERT OR UPDATE ON public.system_tasks
  FOR EACH ROW EXECUTE FUNCTION public.audit_system_task_change();
DROP TRIGGER IF EXISTS audit_system_task_comment ON public.system_task_comments;
CREATE TRIGGER audit_system_task_comment AFTER INSERT ON public.system_task_comments
  FOR EACH ROW EXECUTE FUNCTION public.audit_system_task_comment();
