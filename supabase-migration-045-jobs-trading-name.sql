-- Migration 045: Per-job trading name for client-facing documents
-- Same ABN / address; display name + contact email follow the selected trading name.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS trading_name TEXT DEFAULT NULL
    CHECK (
      trading_name IS NULL
      OR trading_name IN ('brisbane_biohazard_cleaning', 'forensic_cleaning_qld')
    );

COMMENT ON COLUMN jobs.trading_name IS
  'Operating trading name for this job''s client-facing documents. brisbane_biohazard_cleaning | forensic_cleaning_qld. NULL until selected.';
