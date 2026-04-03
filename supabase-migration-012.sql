-- Migration 012: Public website fields + launch flag
--
-- Adds three columns to company_profile:
--   services      JSONB array of service name strings
--   areas_served  JSONB array of suburb/region strings
--   website_live  boolean flag — flipped true when admin clicks "Launch Website"
--
-- The public website template (site/page.tsx) reads all three.
-- The settings page lets admins manage them and trigger the launch.

ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS services     JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS areas_served JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS website_live BOOLEAN  DEFAULT FALSE NOT NULL;
