-- Migration 066: 'hoarding_cleaning_qld' trading name.
--
-- Adds the Hoarding Cleaning QLD brand to the trading_name CHECK constraints on
-- jobs (045) and client_accounts (047). Existing values are unchanged:
-- 'brisbane_biohazard_cleaning' stays the stored id for the brand now displayed
-- as Biohazard Cleaning QLD (label lives in src/lib/tradingNames.ts).
-- Safe to re-run.

-- 045/047 declared the CHECKs inline, so drop whatever name Postgres gave them.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('jobs'::regclass, 'client_accounts'::regclass)
      AND pg_get_constraintdef(oid) LIKE '%trading_name%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

ALTER TABLE jobs ADD CONSTRAINT jobs_trading_name_check
  CHECK (
    trading_name IS NULL
    OR trading_name IN ('brisbane_biohazard_cleaning', 'forensic_cleaning_qld', 'hoarding_cleaning_qld')
  );

ALTER TABLE client_accounts ADD CONSTRAINT client_accounts_trading_name_check
  CHECK (trading_name IN ('brisbane_biohazard_cleaning', 'forensic_cleaning_qld', 'hoarding_cleaning_qld'));

COMMENT ON COLUMN jobs.trading_name IS
  'Operating trading name for this job''s client-facing documents. brisbane_biohazard_cleaning (Biohazard Cleaning QLD) | forensic_cleaning_qld | hoarding_cleaning_qld. NULL until selected. Covered by jobs RLS (service-only).';
