-- Migration 021: Membership foundation audit + role expansion
-- Run in Supabase SQL Editor

-- Audit trail for org/role transitions.
CREATE TABLE IF NOT EXISTS membership_audit (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_clerk_id   TEXT NOT NULL,
  subject_clerk_id TEXT NOT NULL,
  action           TEXT NOT NULL CHECK (action IN ('role_change', 'org_transfer', 'membership_link')),
  from_org_id      UUID REFERENCES orgs(id) ON DELETE SET NULL,
  to_org_id        UUID REFERENCES orgs(id) ON DELETE SET NULL,
  from_role        TEXT,
  to_role          TEXT,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS membership_audit_actor_idx   ON membership_audit(actor_clerk_id);
CREATE INDEX IF NOT EXISTS membership_audit_subject_idx ON membership_audit(subject_clerk_id);
CREATE INDEX IF NOT EXISTS membership_audit_created_idx ON membership_audit(created_at DESC);

-- Expand invite role enum to include manager and team lead.
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE invites
  ADD CONSTRAINT invites_role_check
  CHECK (role IN ('admin', 'manager', 'team_lead', 'member', 'operator', 'field', 'client', 'property_manager', 'body_corp'));

COMMENT ON TABLE membership_audit IS 'Audit events for membership role/org transitions';
