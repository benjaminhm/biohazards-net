-- Migration 012: Composed document bundles (ordered document_ids → single print HTML)
-- Run in Supabase SQL Editor after prior migrations.

CREATE TABLE IF NOT EXISTS document_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  org_id UUID REFERENCES orgs(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Composed document',
  part_document_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_bundles_job_id_idx ON document_bundles(job_id);

ALTER TABLE document_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service only" ON document_bundles
  FOR ALL USING (false);
