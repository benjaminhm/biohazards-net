-- Migration 045: Per-job trading name for client-facing documents
-- Same ABN / address; display name + contact email follow the selected trading name.
--
-- RLS: no new table. Column inherits jobs RLS from migration 011
-- (service-only; API uses service role). Re-assert with migration 046 if needed.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS trading_name TEXT DEFAULT NULL
    CHECK (
      trading_name IS NULL
      OR trading_name IN ('brisbane_biohazard_cleaning', 'forensic_cleaning_qld')
    );

-- Defensive: keep jobs locked even if 011 was skipped on an environment.
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service only" ON jobs;
CREATE POLICY "service only" ON jobs
  FOR ALL USING (false);

COMMENT ON COLUMN jobs.trading_name IS
  'Operating trading name for this job''s client-facing documents. brisbane_biohazard_cleaning | forensic_cleaning_qld. NULL until selected. Covered by jobs RLS (service-only).';
