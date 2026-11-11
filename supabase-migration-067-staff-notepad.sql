-- Migration 067: Staff notepad — one private pad per staff member
-- Run in Supabase SQL Editor (safe to re-run).
--
-- Free text behind the floating Notepad button on every desk page
-- (components/Notepad.tsx, /api/notepad). No AI and no link to a job.
--
-- Scope: one row per (org_id, owner_user_id). owner_user_id is
-- org_users.clerk_user_id, as in brain_dump_items (039). Two people in the
-- same org never see each other's pad.
--
-- RLS: service-only, same pattern as 039 and 046. All access goes through
-- /api/notepad using createServiceClient() after the staff session check,
-- with every query filtered by both org_id AND owner_user_id.

CREATE TABLE IF NOT EXISTS staff_notepads (
  org_id         UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  owner_user_id  TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, owner_user_id),
  -- Keep in step with NOTEPAD_MAX_CHARS in src/lib/notepad.ts.
  CONSTRAINT staff_notepads_body_len CHECK (char_length(body) <= 50000)
);

ALTER TABLE staff_notepads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON staff_notepads;
CREATE POLICY "service only" ON staff_notepads FOR ALL USING (false);

COMMENT ON TABLE staff_notepads IS
  'One private free-text notepad per staff member per org (floating Notepad button). Scoped per-user via owner_user_id; service-role access only.';
COMMENT ON COLUMN staff_notepads.owner_user_id IS
  'org_users.clerk_user_id of the person who owns this pad. All reads and writes filter by (org_id, owner_user_id).';
