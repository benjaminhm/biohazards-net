-- ============================================
-- Brisbane Biohazard Cleaning — Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status        TEXT NOT NULL DEFAULT 'lead'
                  CHECK (status IN ('lead','assessed','quoted','scheduled','underway','completed','report_sent','paid')),
  urgency       TEXT NOT NULL DEFAULT 'standard'
                  CHECK (urgency IN ('standard','urgent','emergency')),
  job_type      TEXT NOT NULL
                  CHECK (job_type IN ('crime_scene','hoarding','mold','sewage','trauma','unattended_death','flood','other')),
  client_name   TEXT NOT NULL,
  client_phone  TEXT NOT NULL DEFAULT '',
  client_email  TEXT NOT NULL DEFAULT '',
  site_address  TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  assessment_data JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Photos table
CREATE TABLE IF NOT EXISTS photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_url    TEXT NOT NULL,
  caption     TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'before'
                CHECK (category IN ('before','during','after','assessment')),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Documents table (generated PDFs)
CREATE TABLE IF NOT EXISTS documents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('quote','sow','report')),
  content    JSONB NOT NULL,
  file_url   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS photos_job_id_idx    ON photos(job_id);
CREATE INDEX IF NOT EXISTS documents_job_id_idx ON documents(job_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx      ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx  ON jobs(created_at DESC);

-- ============================================
-- Supabase Storage Buckets
-- Run these in the SQL Editor too (or create via Dashboard)
-- ============================================

-- Create job-photos bucket (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-photos', 'job-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Create job-pdfs bucket (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-pdfs', 'job-pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (allow all for now — single-user POC)
CREATE POLICY "Allow all operations on job-photos"
ON storage.objects FOR ALL
USING (bucket_id = 'job-photos')
WITH CHECK (bucket_id = 'job-photos');

CREATE POLICY "Allow all operations on job-pdfs"
ON storage.objects FOR ALL
USING (bucket_id = 'job-pdfs')
WITH CHECK (bucket_id = 'job-pdfs');
