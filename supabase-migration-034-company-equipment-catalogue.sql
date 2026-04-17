-- Add equipment_catalogue JSONB column to company_profile.
-- This stores the org-level equipment catalogue that feeds the Assessment →
-- Equipment checklist on every job. Structure is an array of items:
--   [{ "id": "moisture_meter_01", "name": "Moisture meter", "category": "instruments",
--      "notes": "Calibrated quarterly", "archived": false }]
-- Categories are: ppe | containment | cleaning | air | tools | instruments | waste | other.
-- Archived items stay for historical jobs that referenced them but are hidden from
-- new job checklists.
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS equipment_catalogue JSONB DEFAULT NULL;
