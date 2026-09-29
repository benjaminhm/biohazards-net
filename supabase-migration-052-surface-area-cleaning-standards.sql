-- Org-wide Surface Area Cleaning Quote clauses.
-- Edited on the SACQ page and reused on every future job.
-- { "inclusions": "...", "exclusions": "...", "assumptions": "...", "payment_terms": "...", "engagement_agreement": "..." }
-- List fields are one item per line.
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS surface_area_cleaning_standards JSONB DEFAULT NULL;
