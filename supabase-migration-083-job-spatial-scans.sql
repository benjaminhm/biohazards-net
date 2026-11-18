-- Migration 083: LiDAR room scans from the private iPhone field app.
--
-- A scan is a USDZ mesh and a walkthrough video recorded on the same ARKit
-- clock, plus a small JSON timeline that maps video time to the device clock.
-- Files live in the private job-scans bucket. The phone uploads them with a
-- short-lived signed URL from POST /api/photo/scan (photo PIN). The job file
-- only lists rows whose status is ready.
--
-- RLS is on with a deny-all policy. API routes use the service role.

CREATE TABLE IF NOT EXISTS job_spatial_scans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  person_id     UUID REFERENCES people(id) ON DELETE SET NULL,
  person_name   TEXT NOT NULL DEFAULT '',
  person_code   TEXT NOT NULL DEFAULT '',
  mesh_path     TEXT NOT NULL,
  video_path    TEXT NOT NULL,
  timeline_path TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  duration_s    DOUBLE PRECISION,
  note          TEXT NOT NULL DEFAULT '',
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  accuracy_m    DOUBLE PRECISION,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_spatial_scans_status CHECK (status IN ('pending', 'ready'))
);

CREATE INDEX IF NOT EXISTS job_spatial_scans_job_idx
  ON job_spatial_scans (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_spatial_scans_person_idx
  ON job_spatial_scans (person_id, created_at DESC);

ALTER TABLE public.job_spatial_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON public.job_spatial_scans;
CREATE POLICY "service only" ON public.job_spatial_scans FOR ALL USING (false);

COMMENT ON TABLE job_spatial_scans IS
  'LiDAR mesh plus walkthrough video for one job. Service role only. status ready means both files are in the job-scans bucket.';

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('job-scans', 'job-scans', false, 104857600)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;
