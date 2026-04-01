-- Migration 007: Invites table for staff onboarding
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS invites (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  role        TEXT        NOT NULL DEFAULT 'field'
                          CHECK (role IN ('admin', 'operator', 'field')),
  label       TEXT,                     -- optional note e.g. "for Jake Smith"
  invited_by  TEXT        NOT NULL,     -- clerk_user_id of creator
  claimed_by  TEXT,                     -- clerk_user_id when accepted
  claimed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Index for fast token lookup
CREATE INDEX IF NOT EXISTS invites_token_idx ON invites(token);
CREATE INDEX IF NOT EXISTS invites_org_id_idx ON invites(org_id);
