-- Migration 036: Site contact (if different from primary contact)
-- Minimal Initial Contact intake captures a separate on-site contact so the
-- field tech can ring the person holding the key / granting access without
-- going through the caller first.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_contact_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_contact_phone TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN jobs.site_contact_name  IS 'On-site contact when different from the primary client contact (e.g. tenant who opens the door, concierge).';
COMMENT ON COLUMN jobs.site_contact_phone IS 'Phone for the on-site contact; E.164 where known.';
