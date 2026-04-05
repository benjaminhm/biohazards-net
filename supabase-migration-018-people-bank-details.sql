-- Migration 018: Bank details on people (subcontractor payment defaults)
--
-- The app reads these for GET /api/jobs/[id]/invoices → bank_details pre-fill
-- and PATCH /api/people/[id] persists them from the team profile.
-- Per-invoice snapshots also live on subcontractor_invoices (migration 015).

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS bank_account_name   TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bank_bsb            TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT DEFAULT NULL;
