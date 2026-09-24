-- One-off clients accept a quote from the public link without a trade account.
-- Trade-portal rows still store account_id. Public-link rows leave it null.

ALTER TABLE quote_acceptances
  ALTER COLUMN account_id DROP NOT NULL;

COMMENT ON COLUMN quote_acceptances.account_id IS
  'Trade account when accepted in the portal. NULL when accepted from the public quote link.';
