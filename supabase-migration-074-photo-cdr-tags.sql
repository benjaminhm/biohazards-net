-- Migration 074: Contents Disposal Record tags on photos.
--
-- A photo is sorted into the disposal record by its load number and what it
-- shows. The Contents Disposal Record builds its timeline from these tags.
--
--   cdr_load  NULL  not a disposal photo
--             0     a disposal photo not yet sorted into a load
--             1..n  the load it belongs to
--   cdr_role  what the photo shows: the container being loaded, the drop-off,
--             or the docket
--   cdr_read  what was read from the image (role, container, contents, docket
--             weight and fee), kept so each photo is read once. Staff confirm
--             every value on the record before it is used.

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS cdr_load INTEGER,
  ADD COLUMN IF NOT EXISTS cdr_role TEXT,
  ADD COLUMN IF NOT EXISTS cdr_read JSONB;

ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_cdr_load_check;
ALTER TABLE photos ADD CONSTRAINT photos_cdr_load_check
  CHECK (cdr_load IS NULL OR cdr_load >= 0);

ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_cdr_role_check;
ALTER TABLE photos ADD CONSTRAINT photos_cdr_role_check
  CHECK (cdr_role IS NULL OR cdr_role IN ('load', 'dropoff', 'docket'));

CREATE INDEX IF NOT EXISTS photos_job_cdr_load_idx ON photos(job_id) WHERE cdr_load IS NOT NULL;
