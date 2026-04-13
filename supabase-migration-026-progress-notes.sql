-- Progress notes per job — audit-friendly, soft archive & delete
-- Run in Supabase SQL Editor after prior migrations.

CREATE TABLE IF NOT EXISTS progress_notes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id                  UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  room                    TEXT NOT NULL DEFAULT '',
  body                    TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id      TEXT NOT NULL,
  updated_by_user_id      TEXT NOT NULL,
  created_by_first_name   TEXT NOT NULL DEFAULT '',
  updated_by_first_name   TEXT NOT NULL DEFAULT '',
  archived_at             TIMESTAMPTZ,
  archived_by_user_id     TEXT,
  archived_by_first_name  TEXT,
  deleted_at              TIMESTAMPTZ,
  deleted_by_user_id      TEXT,
  deleted_by_first_name   TEXT,
  CONSTRAINT progress_notes_body_len CHECK (char_length(body) <= 50000)
);

CREATE INDEX IF NOT EXISTS progress_notes_job_id_idx
  ON progress_notes(job_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS progress_notes_org_id_idx
  ON progress_notes(org_id);

ALTER TABLE progress_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON progress_notes;
CREATE POLICY "service only" ON progress_notes
  FOR ALL USING (false);
