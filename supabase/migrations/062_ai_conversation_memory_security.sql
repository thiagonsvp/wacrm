-- Harden privileges for functions introduced by migration 061. Supabase
-- projects may have default routine grants for anon/authenticated, so
-- revoke those roles explicitly instead of relying on PUBLIC alone.

ALTER FUNCTION public.sanitize_ai_memory(text) SET search_path = public;

REVOKE ALL ON FUNCTION public.capture_ai_conversation_memory()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sanitize_ai_memory(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_ai_conversation_memory_fts(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sanitize_ai_memory(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_ai_conversation_memory_fts(uuid, text, integer)
  TO service_role;
