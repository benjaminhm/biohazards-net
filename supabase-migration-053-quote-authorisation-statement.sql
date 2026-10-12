-- Org-wide Authorisation to Proceed wording for Quote/Estimate.
-- Edited on the quote page, saved automatically, and reused on future jobs.
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS quote_authorisation_statement TEXT DEFAULT NULL;
