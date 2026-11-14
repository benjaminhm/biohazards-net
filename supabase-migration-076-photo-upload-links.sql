-- Migration 076: temporary phone upload links for a job's photo folder.
--
-- Staff open a QR code on the job's Photos tab. The link lets whoever holds it
-- add photos to that one job until it expires or is stopped. It cannot view,
-- change or delete anything. Photos are credited to the staff member who made
-- the link.

CREATE TABLE IF NOT EXISTS photo_upload_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_by_person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photo_upload_links_job_idx ON photo_upload_links(job_id);

-- Service-only: the app reads and writes this table with the service role.
ALTER TABLE photo_upload_links ENABLE ROW LEVEL SECURITY;
