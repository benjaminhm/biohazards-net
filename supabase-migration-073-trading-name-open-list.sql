-- Migration 073: the brand list lives in the code, not in the database.
--
-- Drops the trading_name CHECK constraints on jobs (045, 066) and
-- client_accounts (047, 066). Each new brand used to need a migration to widen
-- them. The list is now src/lib/tradingNames.ts alone, and every write of
-- trading_name is validated against it in the app (isTradingNameId): the jobs
-- routes and the accounts route.
--
-- Existing values are unchanged. client_accounts.trading_name stays NOT NULL.
-- Safe to re-run.

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_trading_name_check;
ALTER TABLE client_accounts DROP CONSTRAINT IF EXISTS client_accounts_trading_name_check;

COMMENT ON COLUMN jobs.trading_name IS
  'Brand id for this job''s client-facing documents, from the list in src/lib/tradingNames.ts (validated in the app). NULL until selected. Covered by jobs RLS (service-only).';

COMMENT ON COLUMN client_accounts.trading_name IS
  'Brand id this account belongs to, from the list in src/lib/tradingNames.ts (validated in the app).';
