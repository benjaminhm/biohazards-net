-- Soft-archive jobs: hide from default lists while retaining rows for reporting and mining.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by_user_id TEXT;

CREATE INDEX IF NOT EXISTS jobs_org_archived_idx
  ON jobs(org_id, archived_at)
  WHERE archived_at IS NOT NULL;

COMMENT ON COLUMN jobs.archived_at IS 'When set, job is excluded from default /api/jobs lists; use ?include_archived=true to list.';
COMMENT ON COLUMN jobs.archived_by_user_id IS 'Clerk user id who archived the job.';
