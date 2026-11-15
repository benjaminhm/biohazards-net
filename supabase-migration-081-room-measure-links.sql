-- Migration 081: temporary phone links for measuring rooms on a surface area
-- cleaning quote.
--
-- Staff open a QR code beside the room list on the quote. The link lets whoever
-- holds it add a room (name, length, width, height) to that one job's quote, or
-- replace the size of a room already on it, until the link expires or is
-- stopped. It cannot remove a room and it is not shown the rate or the price.
-- Same shape as photo_upload_links (migration 076).

CREATE TABLE IF NOT EXISTS room_measure_links (
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

CREATE INDEX IF NOT EXISTS room_measure_links_job_idx ON room_measure_links(job_id);

-- Service-only: the app reads and writes this table with the service role.
ALTER TABLE room_measure_links ENABLE ROW LEVEL SECURITY;
