-- Field job records for technicians. Separate from quoting jobs.
-- No hard deletes: archive columns. Service role only.

CREATE TABLE IF NOT EXISTS record_chemicals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  dwell_minutes INT NOT NULL CHECK (dwell_minutes >= 0 AND dwell_minutes <= 24 * 60),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS record_template_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  job_type TEXT NOT NULL CHECK (job_type IN ('biohazard', 'hoarding', 'squalor', 'meth_testing', 'mould_testing')),
  position INT NOT NULL CHECK (position > 0),
  title TEXT NOT NULL,
  instruction TEXT NOT NULL DEFAULT '',
  step_type TEXT NOT NULL CHECK (step_type IN ('photo', 'checklist', 'chemical', 'note', 'test_record')),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  min_photos INT NOT NULL DEFAULT 1 CHECK (min_photos >= 0 AND min_photos <= 30),
  checklist_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS record_rates (
  org_id UUID PRIMARY KEY REFERENCES orgs(id),
  biohazard_cents INT NOT NULL DEFAULT 10000 CHECK (biohazard_cents >= 0),
  meth_cents INT NOT NULL DEFAULT 10000 CHECK (meth_cents >= 0),
  mould_cents INT NOT NULL DEFAULT 10000 CHECK (mould_cents >= 0),
  hoarding_cents_per_m3 INT NOT NULL DEFAULT 1000 CHECK (hoarding_cents_per_m3 >= 0),
  squalor_cents_per_m2 INT NOT NULL DEFAULT 250 CHECK (squalor_cents_per_m2 >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS record_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  job_number TEXT NOT NULL,
  address TEXT NOT NULL,
  client_reference TEXT NOT NULL DEFAULT '',
  job_type TEXT NOT NULL CHECK (job_type IN ('biohazard', 'hoarding', 'squalor', 'meth_testing', 'mould_testing')),
  quoted_m3 NUMERIC(10, 2),
  quoted_m2 NUMERIC(10, 2),
  site_lat DOUBLE PRECISION,
  site_lng DOUBLE PRECISION,
  assigned_person_id UUID REFERENCES people(id),
  lead_person_id UUID REFERENCES people(id),
  lead_uplift_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (lead_uplift_percent >= 0 AND lead_uplift_percent <= 100),
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'accepted', 'on_site', 'closed', 'archived')),
  accepted_at TIMESTAMPTZ,
  clock_on_at TIMESTAMPTZ,
  clock_on_lat DOUBLE PRECISION,
  clock_on_lng DOUBLE PRECISION,
  clock_off_at TIMESTAMPTZ,
  clock_off_lat DOUBLE PRECISION,
  clock_off_lng DOUBLE PRECISION,
  closed_at TIMESTAMPTZ,
  records_complete BOOLEAN NOT NULL DEFAULT FALSE,
  records_missing TEXT NOT NULL DEFAULT '',
  bonus_cents INT NOT NULL DEFAULT 0,
  callback_required BOOLEAN NOT NULL DEFAULT FALSE,
  callback_reason TEXT,
  callback_at TIMESTAMPTZ,
  callback_by TEXT,
  technician_comment TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, job_number)
);

CREATE TABLE IF NOT EXISTS record_job_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  job_id UUID NOT NULL REFERENCES record_jobs(id),
  position INT NOT NULL CHECK (position > 0),
  title TEXT NOT NULL,
  instruction TEXT NOT NULL DEFAULT '',
  step_type TEXT NOT NULL CHECK (step_type IN ('photo', 'checklist', 'chemical', 'note', 'test_record')),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  min_photos INT NOT NULL DEFAULT 1,
  checklist_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ticks JSONB NOT NULL DEFAULT '[]'::jsonb,
  note_text TEXT NOT NULL DEFAULT '',
  test_text TEXT NOT NULL DEFAULT '',
  chemical_id UUID REFERENCES record_chemicals(id),
  chemical_name TEXT,
  dwell_minutes INT,
  dwell_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (job_id, position)
);

CREATE TABLE IF NOT EXISTS record_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  job_id UUID NOT NULL REFERENCES record_jobs(id),
  step_id UUID NOT NULL REFERENCES record_job_steps(id),
  storage_path TEXT NOT NULL,
  device_time TIMESTAMPTZ NOT NULL,
  server_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  flagged BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reasons TEXT NOT NULL DEFAULT '',
  created_by_person_id UUID REFERENCES people(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS record_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  job_id UUID NOT NULL REFERENCES record_jobs(id),
  person_id UUID REFERENCES people(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS record_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  job_id UUID REFERENCES record_jobs(id),
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS record_template_steps_org_idx ON record_template_steps (org_id, job_type, position);
CREATE INDEX IF NOT EXISTS record_jobs_org_status_idx ON record_jobs (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS record_jobs_assignee_idx ON record_jobs (assigned_person_id);
CREATE INDEX IF NOT EXISTS record_jobs_lead_idx ON record_jobs (lead_person_id);
CREATE INDEX IF NOT EXISTS record_job_steps_job_idx ON record_job_steps (job_id, position);
CREATE INDEX IF NOT EXISTS record_photos_job_idx ON record_photos (job_id, created_at);
CREATE INDEX IF NOT EXISTS record_notes_job_idx ON record_notes (job_id, created_at);
CREATE INDEX IF NOT EXISTS record_audit_job_idx ON record_audit (job_id, created_at);

ALTER TABLE record_chemicals ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_template_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_job_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON record_chemicals;
DROP POLICY IF EXISTS "service only" ON record_template_steps;
DROP POLICY IF EXISTS "service only" ON record_rates;
DROP POLICY IF EXISTS "service only" ON record_jobs;
DROP POLICY IF EXISTS "service only" ON record_job_steps;
DROP POLICY IF EXISTS "service only" ON record_photos;
DROP POLICY IF EXISTS "service only" ON record_notes;
DROP POLICY IF EXISTS "service only" ON record_audit;

CREATE POLICY "service only" ON record_chemicals FOR ALL USING (false);
CREATE POLICY "service only" ON record_template_steps FOR ALL USING (false);
CREATE POLICY "service only" ON record_rates FOR ALL USING (false);
CREATE POLICY "service only" ON record_jobs FOR ALL USING (false);
CREATE POLICY "service only" ON record_job_steps FOR ALL USING (false);
CREATE POLICY "service only" ON record_photos FOR ALL USING (false);
CREATE POLICY "service only" ON record_notes FOR ALL USING (false);
CREATE POLICY "service only" ON record_audit FOR ALL USING (false);

INSERT INTO storage.buckets (id, name, public)
VALUES ('record-photos', 'record-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;
