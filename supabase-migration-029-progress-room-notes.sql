-- Progress Photos room-level notes with audit fields.
-- Run after migration 028.

CREATE TABLE IF NOT EXISTS progress_room_notes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id               UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  room_name            TEXT NOT NULL,
  note                 TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id   TEXT NOT NULL,
  updated_by_user_id   TEXT NOT NULL,
  created_by_first_name TEXT NOT NULL DEFAULT '',
  updated_by_first_name TEXT NOT NULL DEFAULT '',
  CONSTRAINT progress_room_notes_len CHECK (char_length(note) <= 50000),
  CONSTRAINT progress_room_notes_uniq UNIQUE (org_id, job_id, room_name)
);

CREATE INDEX IF NOT EXISTS progress_room_notes_job_idx
  ON progress_room_notes(job_id);

ALTER TABLE progress_room_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON progress_room_notes;
CREATE POLICY "service only" ON progress_room_notes
  FOR ALL USING (false);
