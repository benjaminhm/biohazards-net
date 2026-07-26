-- Migration 048: Trade account application fields
-- Run in Supabase SQL Editor (safe to re-run).
--
-- Context:
--   Migration 047 gave a trade account only the details staff needed to invoice
--   it. This adds the details we need *before* quoting: the legal entity and its
--   directors, who actually pays, on what terms, and two trade references to
--   check. The client's admin officer fills these in themselves at
--   accounts.<brand>.com.au — they know their own registered details better than
--   we do — and then presses "Submit for review", which stamps
--   application_submitted_at and locks the form.
--
--   Everything is nullable: accounts created under 047 stay valid and simply
--   read as an unsubmitted application.
--
-- References are two fixed slots rather than a child table. It is two rows and
-- always will be, and columns keep the form, the API and the staff view trivial.
--
-- RLS: no new tables, so no new policies. client_accounts remains service-only
-- from 047; tenancy is enforced in application code with .eq('org_id', orgId),
-- and portal writes additionally scope by the session's client_account_id.
--
-- The Supabase SQL editor flags ALTER TABLE as a "destructive operation". It is
-- not: every statement is ADD COLUMN IF NOT EXISTS on a nullable column with no
-- default backfill, so no existing row is rewritten or altered.

-- ── Legal entity ────────────────────────────────────────────────────────────
-- Distinct from billing_address (047): the registered head office is what a
-- credit check is run against, and it is often not where invoices are sent.
ALTER TABLE client_accounts
  ADD COLUMN IF NOT EXISTS head_office_address TEXT,
  ADD COLUMN IF NOT EXISTS director_name       TEXT,
  ADD COLUMN IF NOT EXISTS director_email      TEXT,
  ADD COLUMN IF NOT EXISTS director_phone      TEXT;

-- ── Accounts payable ────────────────────────────────────────────────────────
-- The person who actually releases payment (CFO, finance manager, AP officer).
-- Deliberately not a client_account_contacts row: this person is a payment
-- contact, not necessarily someone we grant a portal login to.
ALTER TABLE client_accounts
  ADD COLUMN IF NOT EXISTS finance_contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS finance_contact_title TEXT,
  ADD COLUMN IF NOT EXISTS finance_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS finance_contact_phone TEXT;

-- ── Payment behaviour ───────────────────────────────────────────────────────
-- Free text rather than an enum: how a company describes its own terms and pay
-- run varies, and forcing it into codes would lose the detail that makes the
-- answer useful when chasing an invoice.
ALTER TABLE client_accounts
  ADD COLUMN IF NOT EXISTS payment_terms          TEXT,
  ADD COLUMN IF NOT EXISTS payment_run_days       TEXT,
  ADD COLUMN IF NOT EXISTS payment_method         TEXT,
  ADD COLUMN IF NOT EXISTS purchase_order_required BOOLEAN NOT NULL DEFAULT false;

-- ── Trade references ────────────────────────────────────────────────────────
ALTER TABLE client_accounts
  ADD COLUMN IF NOT EXISTS reference1_company TEXT,
  ADD COLUMN IF NOT EXISTS reference1_contact TEXT,
  ADD COLUMN IF NOT EXISTS reference1_phone   TEXT,
  ADD COLUMN IF NOT EXISTS reference1_email   TEXT,
  ADD COLUMN IF NOT EXISTS reference2_company TEXT,
  ADD COLUMN IF NOT EXISTS reference2_contact TEXT,
  ADD COLUMN IF NOT EXISTS reference2_phone   TEXT,
  ADD COLUMN IF NOT EXISTS reference2_email   TEXT;

-- ── Submission state ────────────────────────────────────────────────────────
-- application_submitted_at is the single source of truth for "locked": the
-- portal refuses writes while it is set, and staff clear it to reopen.
-- The contact reference is SET NULL so reopening history survives a contact
-- being removed.
ALTER TABLE client_accounts
  ADD COLUMN IF NOT EXISTS application_submitted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS application_submitted_by_contact_id UUID,
  ADD COLUMN IF NOT EXISTS application_reopened_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS application_reopened_by_user_id  TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_accounts_application_contact_fk'
  ) THEN
    ALTER TABLE client_accounts
      ADD CONSTRAINT client_accounts_application_contact_fk
      FOREIGN KEY (application_submitted_by_contact_id)
      REFERENCES client_account_contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Staff list view filters on "awaiting review" for this org.
CREATE INDEX IF NOT EXISTS client_accounts_application_submitted_idx
  ON client_accounts(org_id, application_submitted_at);

-- ── Length limits ───────────────────────────────────────────────────────────
-- Matching 047's approach: added as named constraints in a guarded block so the
-- migration stays re-runnable.
DO $$
DECLARE
  c record;
  limits CONSTANT text[][] := ARRAY[
    ARRAY['head_office_address',    '1000'],
    ARRAY['director_name',          '240'],
    ARRAY['director_email',         '320'],
    ARRAY['director_phone',         '40'],
    ARRAY['finance_contact_name',   '240'],
    ARRAY['finance_contact_title',  '240'],
    ARRAY['finance_contact_email',  '320'],
    ARRAY['finance_contact_phone',  '40'],
    ARRAY['payment_terms',          '240'],
    ARRAY['payment_run_days',       '240'],
    ARRAY['payment_method',         '240'],
    ARRAY['reference1_company',     '240'],
    ARRAY['reference1_contact',     '240'],
    ARRAY['reference1_phone',       '40'],
    ARRAY['reference1_email',       '320'],
    ARRAY['reference2_company',     '240'],
    ARRAY['reference2_contact',     '240'],
    ARRAY['reference2_phone',       '40'],
    ARRAY['reference2_email',       '320']
  ];
  i int;
  col text;
  len text;
  cname text;
BEGIN
  FOR i IN 1 .. array_length(limits, 1) LOOP
    col := limits[i][1];
    len := limits[i][2];
    cname := 'client_accounts_' || col || '_len';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cname) THEN
      EXECUTE format(
        'ALTER TABLE client_accounts ADD CONSTRAINT %I CHECK (%I IS NULL OR char_length(%I) <= %s)',
        cname, col, col, len
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN client_accounts.application_submitted_at IS
  'Set when the client presses Submit for review in the accounts portal. While set, portal writes to the profile are refused. Staff clear it to reopen the form. NULL means the application is still being filled in.';

COMMENT ON COLUMN client_accounts.purchase_order_required IS
  'Client states a PO number must appear on invoices. Surfaced to staff when raising work for this account.';
