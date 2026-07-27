-- A contact has one inbox conversation. The inbound handler already
-- reuses an existing row; this constraint also closes the race window
-- when two webhook deliveries arrive at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_unique
  ON conversations (account_id, contact_id);
