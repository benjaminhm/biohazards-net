-- Migration 077: receipts on a job (tip receipts first).
--
-- A receipt is one image with its own facts, kept apart from the job's photos
-- so it never lands in a report or a photo picker. Details are read from the
-- image as suggestions; nothing counts until a person confirms the receipt.
-- A confirmed receipt linked to disposal record loads sets those loads' tip
-- fee and weight, split by volume.
--
-- job_receipt_loads links a receipt to the loads it covers, by the load's
-- photo (one photo is one load). Deleting the photo drops the link.

CREATE TABLE IF NOT EXISTS job_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  storage_path TEXT,
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  supplier TEXT NOT NULL DEFAULT '',
  receipt_at TIMESTAMPTZ,
  docket_no TEXT NOT NULL DEFAULT '',
  total_inc_gst NUMERIC(12, 2),
  gst NUMERIC(12, 2),
  weight_kg NUMERIC(12, 2),
  read JSONB,
  confirmed_at TIMESTAMPTZ,
  confirmed_by_name TEXT,
  dext_sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_receipts_job_idx ON job_receipts(job_id);

CREATE TABLE IF NOT EXISTS job_receipt_loads (
  receipt_id UUID NOT NULL REFERENCES job_receipts(id) ON DELETE CASCADE,
  load_photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  PRIMARY KEY (receipt_id, load_photo_id)
);

CREATE INDEX IF NOT EXISTS job_receipt_loads_photo_idx ON job_receipt_loads(load_photo_id);

-- Service-only, like the other job tables.
ALTER TABLE job_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_receipt_loads ENABLE ROW LEVEL SECURITY;
