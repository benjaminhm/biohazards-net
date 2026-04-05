-- Platform-admin tenant impersonation audit (training / debugging)
-- Run in Supabase SQL Editor after backup.

CREATE TABLE IF NOT EXISTS impersonation_audit (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_clerk_id   TEXT NOT NULL,
  org_id           UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  action           TEXT NOT NULL CHECK (action IN ('start', 'end')),
  reason           TEXT,
  read_only        BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS impersonation_audit_actor_idx ON impersonation_audit(actor_clerk_id);
CREATE INDEX IF NOT EXISTS impersonation_audit_org_idx ON impersonation_audit(org_id);
CREATE INDEX IF NOT EXISTS impersonation_audit_created_idx ON impersonation_audit(created_at DESC);

COMMENT ON TABLE impersonation_audit IS 'Audit log for platform-admin org impersonation sessions';
