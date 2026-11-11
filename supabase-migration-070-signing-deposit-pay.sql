-- Migration 070: Pay deposit step after a quote is signed
-- Run in Supabase SQL Editor (safe to re-run).
--
-- The client's document link is a funnel: view, sign, pay deposit. After
-- signing, the same link shows the deposit to pay, the bank transfer details,
-- and (once staff approve the invoice in Xero) a Pay by card button that opens
-- Xero's online invoice. What has been paid is read back from Xero.
--
-- signing_requests.deposit_percent
--   Share of the quote total (inc GST) the client is asked to pay up front.
--   Chosen by staff when the link is created. NULL = no pay step.
--
-- xero_job_invoices: what was last read from Xero for the pay step, so a
--   client reloading the page does not call Xero every time.
--   online_invoice_url  Xero's "pay online" page for the invoice. Only exists
--                       once the invoice is approved in Xero.
--   amount_paid / amount_due / paid_on / pay_checked_at
--
-- org_payment_details: the bank account clients are told to pay into. Its own
--   table (not company_profile) on purpose: company_profile is readable by the
--   public website and editable by any signed-in staff member, and the account
--   clients pay into must be neither. Only admins can change it (app-enforced),
--   and who changed it last is recorded.

ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS deposit_percent NUMERIC(5,2)
    CHECK (deposit_percent IS NULL OR (deposit_percent > 0 AND deposit_percent <= 100));

COMMENT ON COLUMN signing_requests.deposit_percent IS
  'Share of quote_total (inc GST) asked for as a deposit on the pay step after signing. NULL = no pay step.';

ALTER TABLE xero_job_invoices
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC,
  ADD COLUMN IF NOT EXISTS amount_due NUMERIC,
  ADD COLUMN IF NOT EXISTS paid_on DATE,
  ADD COLUMN IF NOT EXISTS online_invoice_url TEXT,
  ADD COLUMN IF NOT EXISTS pay_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN xero_job_invoices.online_invoice_url IS
  'Xero online invoice (pay) link, read once the invoice is approved in Xero. Shown to the client as Pay by card.';

CREATE TABLE IF NOT EXISTS org_payment_details (
  org_id         UUID PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  account_name   TEXT NOT NULL DEFAULT '',
  bsb            TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  updated_by     TEXT NOT NULL DEFAULT '',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE org_payment_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON org_payment_details;
CREATE POLICY "service only" ON org_payment_details FOR ALL USING (false);

REVOKE ALL ON org_payment_details FROM anon, authenticated;
