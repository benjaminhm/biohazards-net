-- Standalone photo capture app (photo.forensiccleaningqld.com.au / photo.biohazards.net).
-- Each active person in `people` can have a 4-digit `photo_pin` that identifies them on the photo app.
-- Captured photos are stored in `standalone_photos` with watermarked JPEG in `record-photos` bucket.

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS photo_pin TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS people_org_photo_pin_idx
  ON people (org_id, photo_pin)
  WHERE photo_pin IS NOT NULL AND status = 'active';

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS job_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_org_job_code_idx
  ON jobs (org_id, job_code)
  WHERE job_code IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS standalone_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  person_id UUID NOT NULL REFERENCES people(id),
  person_name TEXT NOT NULL,
  person_code TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  device_time TIMESTAMPTZ NOT NULL,
  server_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  accuracy_m DOUBLE PRECISION,
  stamp_text TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  job_code TEXT NOT NULL DEFAULT '',
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS standalone_photos_org_created_idx
  ON standalone_photos (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS standalone_photos_person_idx
  ON standalone_photos (person_id, created_at DESC);

ALTER TABLE standalone_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON standalone_photos;
CREATE POLICY "service only" ON standalone_photos FOR ALL USING (false);
