-- Person-scoped job tasks.
-- Stores task instructions assigned to one team member for one job.

CREATE TABLE IF NOT EXISTS person_job_tasks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id             UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  person_id          UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  body               TEXT NOT NULL,
  completed          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id TEXT NOT NULL DEFAULT '',
  updated_by_user_id TEXT NOT NULL DEFAULT '',
  CONSTRAINT person_job_tasks_body_len CHECK (char_length(body) BETWEEN 1 AND 5000)
);

CREATE INDEX IF NOT EXISTS person_job_tasks_person_job_idx
  ON person_job_tasks(org_id, person_id, job_id, created_at);

CREATE INDEX IF NOT EXISTS person_job_tasks_job_idx
  ON person_job_tasks(org_id, job_id);

ALTER TABLE person_job_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON person_job_tasks;
CREATE POLICY "service only" ON person_job_tasks
  FOR ALL USING (false);
