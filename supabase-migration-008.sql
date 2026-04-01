-- Migration 008: Multiple phone numbers on jobs
-- Adds a JSONB array for additional contact numbers beyond the primary client_phone
-- Format: [{"label": "Landline", "number": "07 3xxx xxxx"}, {"label": "Mobile 2", "number": "04xx xxx xxx"}]

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_phones JSONB NOT NULL DEFAULT '[]'::jsonb;
