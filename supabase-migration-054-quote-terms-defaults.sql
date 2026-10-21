-- Org-wide Payment terms and Quote validity for Quote/Estimate.
-- Edited on the quote page, saved automatically, and reused on future jobs.
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS quote_payment_terms TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS quote_validity TEXT DEFAULT NULL;
