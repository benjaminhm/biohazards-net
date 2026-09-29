-- Org-wide Contents Clearance Quote clauses.
-- Edited on the CCQ page and reused on every future job.
-- { "inclusions": "...", "exclusions": "...", "assumptions": "...", "payment_terms": "..." }
-- List fields are one item per line.
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS contents_clearance_standards JSONB DEFAULT NULL;
