-- Field photo evidence metadata.
-- Stores who uploaded a photo and where/when it was captured for audit-quality
-- team-member evidence (job site, tip run, disposal, etc.).

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_by_person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS uploaded_by_name TEXT,
  ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_label TEXT,
  ADD COLUMN IF NOT EXISTS location_place_id TEXT;

CREATE INDEX IF NOT EXISTS photos_uploaded_by_person_id_idx ON photos(uploaded_by_person_id);
CREATE INDEX IF NOT EXISTS photos_taken_at_idx ON photos(taken_at DESC);

COMMENT ON COLUMN photos.uploaded_by_user_id IS 'Clerk user id of the user who uploaded the photo.';
COMMENT ON COLUMN photos.uploaded_by_person_id IS 'Linked people.id of the team member who uploaded the photo, when available.';
COMMENT ON COLUMN photos.uploaded_by_name IS 'Display name stamped at upload time for audit-friendly evidence display.';
COMMENT ON COLUMN photos.taken_at IS 'Device/photo capture timestamp when available; defaults to upload-time input from client.';
COMMENT ON COLUMN photos.location_lat IS 'Photo capture latitude from browser/device geolocation, if granted.';
COMMENT ON COLUMN photos.location_lng IS 'Photo capture longitude from browser/device geolocation, if granted.';
COMMENT ON COLUMN photos.location_accuracy_m IS 'Device-reported geolocation accuracy in metres.';
COMMENT ON COLUMN photos.location_label IS 'Human-readable reverse-geocoded photo location label, if available.';
COMMENT ON COLUMN photos.location_place_id IS 'Google place_id from reverse geocoding, if available.';
