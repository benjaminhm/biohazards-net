-- Person-scoped job notes.
-- Stores one freeform note for one team member on one job.

CREATE TABLE IF NOT EXISTS person_job_notes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id             UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  person_id          UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  note               TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id TEXT NOT NULL DEFAULT '',
  updated_by_user_id TEXT NOT NULL DEFAULT '',
  CONSTRAINT person_job_notes_note_len CHECK (char_length(note) <= 50000),
  CONSTRAINT person_job_notes_uniq UNIQUE (org_id, person_id, job_id)
);

CREATE INDEX IF NOT EXISTS person_job_notes_person_job_idx
  ON person_job_notes(org_id, person_id, job_id);

CREATE INDEX IF NOT EXISTS person_job_notes_job_idx
  ON person_job_notes(org_id, job_id);

ALTER TABLE person_job_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON person_job_notes;
CREATE POLICY "service only" ON person_job_notes
  FOR ALL USING (false);
