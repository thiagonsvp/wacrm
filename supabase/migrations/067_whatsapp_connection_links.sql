-- Temporary, public links used by a customer to pair one UAZAPI instance.
-- Only the SHA-256 token digest is persisted; possession of the plaintext
-- URL is the capability. Links expire quickly and are consumed on connect.

CREATE TABLE IF NOT EXISTS whatsapp_connection_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT whatsapp_connection_links_expiry_after_creation
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_connection_links_active_instance
  ON whatsapp_connection_links(account_id, instance_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_connection_links_one_active
  ON whatsapp_connection_links(account_id, instance_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE whatsapp_connection_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_connection_links_admin ON whatsapp_connection_links;
CREATE POLICY whatsapp_connection_links_admin ON whatsapp_connection_links FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- The public pairing endpoint uses the service role and returns a fixed,
-- allow-listed response shape. Anonymous users get no direct table access.
REVOKE ALL ON whatsapp_connection_links FROM anon;

-- Revoke-and-replace is one transaction. The advisory lock serializes two
-- browser clicks for the same instance so the partial unique index cannot race.
CREATE OR REPLACE FUNCTION issue_whatsapp_connection_link(
  p_account_id UUID,
  p_instance_id TEXT,
  p_token_hash TEXT
) RETURNS TABLE(id UUID, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'insufficient role' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_account_id::TEXT || ':' || p_instance_id, 0)
  );

  UPDATE whatsapp_connection_links
  SET revoked_at = NOW()
  WHERE account_id = p_account_id
    AND instance_id = p_instance_id
    AND used_at IS NULL
    AND revoked_at IS NULL;

  RETURN QUERY
  INSERT INTO whatsapp_connection_links (
    account_id, instance_id, token_hash, created_by_user_id, expires_at
  ) VALUES (
    p_account_id, p_instance_id, p_token_hash, auth.uid(), statement_timestamp() + INTERVAL '10 minutes'
  )
  RETURNING whatsapp_connection_links.id, whatsapp_connection_links.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION issue_whatsapp_connection_link(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_whatsapp_connection_link(UUID, TEXT, TEXT) TO authenticated;
