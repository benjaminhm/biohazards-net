-- Migration 038: Google-backed site address sidecars
-- Keeps jobs.site_address as the authoritative string (consumed by ~50
-- downstream readers — PDFs, prompts, invoices, docs, exports) and adds
-- structured sidecars for map links, geocoding reuse, and distance math.
--
-- site_place_id  - Google Place ID returned by Places API (New).
-- site_lat/_lng  - Lat/Lng doubles; nullable because (0,0) is a legitimate coord.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_place_id TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_lat      DOUBLE PRECISION;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_lng      DOUBLE PRECISION;

COMMENT ON COLUMN jobs.site_place_id IS 'Google Places API (New) place_id for the site address; empty string when the address was free-typed or predates the autocomplete.';
COMMENT ON COLUMN jobs.site_lat      IS 'Site latitude (WGS84). NULL when not yet geocoded.';
COMMENT ON COLUMN jobs.site_lng      IS 'Site longitude (WGS84). NULL when not yet geocoded.';
