-- Migration 013: Add address and ABN to people profiles
--
-- Team members need to self-complete their profile on first login.
-- address — home/postal address (required for WHS records)
-- abn     — ABN for subcontractors (required for invoicing)

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS address TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS abn     TEXT DEFAULT NULL;
