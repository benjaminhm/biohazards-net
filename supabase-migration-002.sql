-- Migration 002: Company profile + photo area references

-- Company profile table (single row — one company per app)
CREATE TABLE IF NOT EXISTS company_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Brisbane Biohazard Cleaning',
  abn TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  licence TEXT DEFAULT '',
  tagline TEXT DEFAULT 'Professional Biohazard Remediation Services',
  logo_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default row if none exists
INSERT INTO company_profile (name, tagline)
SELECT 'Brisbane Biohazard Cleaning', 'Professional Biohazard Remediation Services'
WHERE NOT EXISTS (SELECT 1 FROM company_profile);

-- Add area_ref column to photos (links photo to a specific area/room)
ALTER TABLE photos ADD COLUMN IF NOT EXISTS area_ref TEXT DEFAULT '';

-- Storage bucket for company assets (logo, etc.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-assets', 'company-assets', true)
ON CONFLICT (id) DO NOTHING;
