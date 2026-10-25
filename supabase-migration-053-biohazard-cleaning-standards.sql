-- Org-wide Biohazard Cleaning Quote template.
-- Each job copies it into assessment_data.biohazard_cleaning_quote.clauses and edits its own copy.
-- "Save as default for future jobs" on the BCQ page writes one clause back here.
-- { "scope_of_work": "...", "inclusions": "...", "exclusions": "...", "assumptions": "...", "payment_terms": "...", "engagement_agreement": "..." }
-- List fields are one item per line.
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS biohazard_cleaning_standards JSONB DEFAULT NULL;
