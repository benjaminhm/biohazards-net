-- Migration 071: Sign, check, then pay
-- Run in Supabase SQL Editor (safe to re-run).
--
-- A signature no longer creates the Xero invoice by itself. A person checks
-- who signed and what they accepted, then creates the invoice from the quote
-- in Documents. The client's page shows no payment details until that check is
-- done and the invoice is approved in Xero.
--
-- signing_requests
--   invoice_confirmed_at / invoice_confirmed_by
--       When the staff check was done, and by whom. NULL on a signed request
--       means it is still waiting for the check: no invoice is created or
--       changed for the job, and the client sees "your invoice is being prepared".
--   xero_contact_id
--       The Xero contact the invoice was raised to at the check.
--   signer_details
--       What the signer typed on the "Your details" step (capacity, legal name,
--       date of birth, residential address, mobile, email, company) and the
--       declaration they agreed to, exactly as worded.
--   pay_token_hash
--       Hash of a second private link to the same page, made when staff ask for
--       the "ready to pay" message. Only a hash of a link is ever kept, so the
--       first link cannot be shown again; this one is made to be sent. Both
--       links open the same page and ask for the same passcode.
--
-- Requests signed before this change are marked as checked, so their invoices
-- and pay steps carry on exactly as they were. That is done once only, when
-- the column is first added: running this file again never marks a later
-- signature as checked.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'signing_requests' AND column_name = 'invoice_confirmed_at'
  ) THEN
    ALTER TABLE signing_requests ADD COLUMN invoice_confirmed_at TIMESTAMPTZ;
    UPDATE signing_requests
       SET invoice_confirmed_at = COALESCE(signed_at, NOW())
     WHERE status = 'signed';
  END IF;
END $$;

ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS invoice_confirmed_by TEXT,
  ADD COLUMN IF NOT EXISTS xero_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS signer_details JSONB,
  ADD COLUMN IF NOT EXISTS pay_token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS signing_requests_pay_token_hash_key
  ON signing_requests (pay_token_hash)
  WHERE pay_token_hash IS NOT NULL;

COMMENT ON COLUMN signing_requests.invoice_confirmed_at IS
  'When staff checked the signed request and created (or confirmed) the invoice. NULL on a signed request = waiting for the staff check.';
COMMENT ON COLUMN signing_requests.signer_details IS
  'Details the signer typed before signing, with the declaration they agreed to. Shown to staff at the check and printed on the signature docket (not the date of birth).';
COMMENT ON COLUMN signing_requests.pay_token_hash IS
  'Hash of the second link to this request, created for the ready-to-pay message staff send themselves.';
