-- Migration 037: Access notes on jobs
-- Captures parking, key handling, entry preferences, pets/hazards, discretion,
-- and any other "how do we get in / how do we behave on site" detail gathered
-- during Initial Contact. Kept as a single free-text blob instead of six
-- discrete columns so the operator isn't nickel-and-dimed by schema.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS access_notes TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN jobs.access_notes IS 'Free-text site access / arrival / discretion notes captured at Initial Contact (parking, keys, pets, tenant sensitivities, etc.).';
