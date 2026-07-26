-- Migration 047: Commercial (trade) accounts + magic-link portal
-- Run in Supabase SQL Editor (safe to re-run).
--
-- Context:
--   Trade accounts log in at accounts.<brand>.com.au via a magic link — auth is
--   separate from Clerk (staff only). A contact signs standing Terms & Conditions
--   once against the account, after which each quote needs only an authenticated
--   click to accept.
--
--   Client identity previously lived denormalised on jobs (client_name,
--   client_email, client_organization_name). client_accounts is the first real
--   account entity; jobs.client_account_id links a job to it. Jobs stay usable
--   with no account (one-off residential work) — the column is nullable.
--
-- RLS: every new table is service-only, matching migrations 011 / 023 / 046.
-- Tenancy is enforced in application code with .eq('org_id', orgId), and portal
-- routes additionally scope by client_account_id from the session cookie.
--
-- The Supabase SQL editor flags this as containing "destructive operations". It
-- does not touch existing data: the hits are DROP POLICY (an RLS policy on the
-- tables created just above, dropped and immediately recreated so the migration
-- is re-runnable), ALTER TABLE ... ADD COLUMN IF NOT EXISTS (nullable, DEFAULT
-- NULL, so no table rewrite), and the word DELETE inside ON DELETE foreign-key
-- rules, which describe future behaviour rather than deleting anything now.

-- ── Accounts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_accounts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- Which trading brand's accounts area this account belongs to. Mirrors the
  -- jobs.trading_name CHECK (045) so the portal host maps to a brand.
  trading_name                TEXT NOT NULL
    CHECK (trading_name IN ('brisbane_biohazard_cleaning', 'forensic_cleaning_qld')),
  legal_name                  TEXT NOT NULL,
  trading_as                  TEXT NOT NULL DEFAULT '',
  abn                         TEXT NOT NULL DEFAULT '',
  billing_email               TEXT NOT NULL DEFAULT '',
  billing_address             TEXT NOT NULL DEFAULT '',
  phone                       TEXT NOT NULL DEFAULT '',
  notes                       TEXT NOT NULL DEFAULT '',
  status                      TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  -- Standing T&Cs. Version strings are defined in src/lib/portal/terms.ts and
  -- git history is the record of what each version said.
  terms_version               TEXT,
  terms_accepted_at           TIMESTAMPTZ,
  terms_accepted_by_contact_id UUID,
  terms_accepted_ip           TEXT,
  terms_accepted_user_agent   TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id          TEXT NOT NULL DEFAULT '',
  updated_by_user_id          TEXT NOT NULL DEFAULT '',
  CONSTRAINT client_accounts_legal_name_len CHECK (char_length(legal_name) BETWEEN 1 AND 240),
  CONSTRAINT client_accounts_trading_as_len CHECK (char_length(trading_as) <= 240),
  CONSTRAINT client_accounts_abn_len CHECK (char_length(abn) <= 40),
  CONSTRAINT client_accounts_billing_email_len CHECK (char_length(billing_email) <= 320),
  CONSTRAINT client_accounts_billing_address_len CHECK (char_length(billing_address) <= 1000),
  CONSTRAINT client_accounts_phone_len CHECK (char_length(phone) <= 40),
  CONSTRAINT client_accounts_notes_len CHECK (char_length(notes) <= 20000)
);

CREATE INDEX IF NOT EXISTS client_accounts_org_idx
  ON client_accounts(org_id, status, legal_name);

CREATE INDEX IF NOT EXISTS client_accounts_org_brand_idx
  ON client_accounts(org_id, trading_name);

-- ── Contacts (the people who log in) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_account_contacts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  account_id         UUID NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  email              TEXT NOT NULL,
  phone              TEXT NOT NULL DEFAULT '',
  title              TEXT NOT NULL DEFAULT '',
  is_primary         BOOLEAN NOT NULL DEFAULT false,
  -- Not every contact should be able to commit the company to a quote.
  can_accept_quotes  BOOLEAN NOT NULL DEFAULT true,
  status             TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  last_login_at      TIMESTAMPTZ,
  invited_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id TEXT NOT NULL DEFAULT '',
  updated_by_user_id TEXT NOT NULL DEFAULT '',
  CONSTRAINT client_account_contacts_name_len CHECK (char_length(name) BETWEEN 1 AND 240),
  CONSTRAINT client_account_contacts_email_len CHECK (char_length(email) BETWEEN 3 AND 320),
  CONSTRAINT client_account_contacts_phone_len CHECK (char_length(phone) <= 40),
  CONSTRAINT client_account_contacts_title_len CHECK (char_length(title) <= 240)
);

-- One login identity per email per org: the magic-link lookup is by email alone,
-- so the same address must not resolve to two accounts.
CREATE UNIQUE INDEX IF NOT EXISTS client_account_contacts_org_email_uniq
  ON client_account_contacts(org_id, lower(email));

CREATE INDEX IF NOT EXISTS client_account_contacts_account_idx
  ON client_account_contacts(org_id, account_id, status);

-- Added after the contacts table exists (circular reference), guarded so the
-- whole migration stays re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_accounts_terms_contact_fk'
  ) THEN
    ALTER TABLE client_accounts
      ADD CONSTRAINT client_accounts_terms_contact_fk
      FOREIGN KEY (terms_accepted_by_contact_id)
      REFERENCES client_account_contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Magic-link login tokens ─────────────────────────────────────────────────
-- token_hash is SHA-256 of the raw token. The raw value only ever exists in the
-- email, so a database leak cannot be replayed as a login.
CREATE TABLE IF NOT EXISTS client_portal_login_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES client_account_contacts(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,
  -- Recorded at issue so rate limiting still works after a contact is renamed
  -- or their email is changed.
  email_at_issue TEXT NOT NULL DEFAULT '',
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  requested_ip  TEXT NOT NULL DEFAULT '',
  requested_user_agent TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_portal_login_tokens_hash_len CHECK (char_length(token_hash) BETWEEN 32 AND 128)
);

CREATE UNIQUE INDEX IF NOT EXISTS client_portal_login_tokens_hash_uniq
  ON client_portal_login_tokens(token_hash);

-- Rate-limit counters read (email, created_at) and (ip, created_at).
CREATE INDEX IF NOT EXISTS client_portal_login_tokens_email_idx
  ON client_portal_login_tokens(lower(email_at_issue), created_at DESC);

CREATE INDEX IF NOT EXISTS client_portal_login_tokens_ip_idx
  ON client_portal_login_tokens(requested_ip, created_at DESC);

-- ── Quote acceptance audit ──────────────────────────────────────────────────
-- Append-only evidence that a named contact accepted a specific quote document
-- under a specific T&Cs version. Never updated or deleted by the application.
--
-- contact_id / job_id / document_id are nullable and SET NULL rather than
-- CASCADE: this row must outlive the records it points at. Staff can hard-delete
-- a document from the job file (DELETE /api/documents/[id], the trash icon on the
-- Docs tab), and cascading would silently destroy the proof that a client
-- authorised the work. The denormalised contact_name / contact_email /
-- quote_reference / quote_total / terms_version columns exist precisely so an
-- orphaned row is still complete evidence.
--
-- org_id and account_id stay CASCADE: deleting an org or the whole trade account
-- is a deliberate teardown of the relationship, not incidental tidying.
CREATE TABLE IF NOT EXISTS quote_acceptances (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  contact_id     UUID REFERENCES client_account_contacts(id) ON DELETE SET NULL,
  job_id         UUID REFERENCES jobs(id) ON DELETE SET NULL,
  document_id    UUID REFERENCES documents(id) ON DELETE SET NULL,
  contact_name   TEXT NOT NULL DEFAULT '',
  contact_email  TEXT NOT NULL DEFAULT '',
  quote_total    NUMERIC(12, 2),
  quote_reference TEXT NOT NULL DEFAULT '',
  terms_version  TEXT NOT NULL DEFAULT '',
  accepted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip             TEXT NOT NULL DEFAULT '',
  user_agent     TEXT NOT NULL DEFAULT ''
);

-- A given quote document is accepted once. Postgres allows repeated NULLs in a
-- unique index, so rows orphaned by a deleted document never collide.
CREATE UNIQUE INDEX IF NOT EXISTS quote_acceptances_document_uniq
  ON quote_acceptances(document_id);

CREATE INDEX IF NOT EXISTS quote_acceptances_account_idx
  ON quote_acceptances(org_id, account_id, accepted_at DESC);

-- ── Job → account link ─────────────────────────────────────────────────────
-- Nullable: one-off residential jobs have no trade account. ON DELETE SET NULL
-- so removing an account never destroys job history.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS client_account_id UUID DEFAULT NULL
    REFERENCES client_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_client_account_idx
  ON jobs(org_id, client_account_id, created_at DESC);

COMMENT ON COLUMN jobs.client_account_id IS
  'Commercial trade account this job belongs to, set by staff on the job file. NULL for one-off clients. Drives what the accounts portal can see. Covered by jobs RLS (service-only).';

-- ── Document release gate ──────────────────────────────────────────────────
-- The portal lists only released documents, so internal drafts are never
-- exposed by simply existing.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS released_to_portal_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS released_by_user_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS documents_released_idx
  ON documents(job_id, released_to_portal_at);

COMMENT ON COLUMN documents.released_to_portal_at IS
  'Set when staff release this document to the commercial accounts portal. NULL means internal-only. Covered by documents RLS (service-only).';

-- ── RLS: service-only on every new table ───────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'client_accounts',
    'client_account_contacts',
    'client_portal_login_tokens',
    'quote_acceptances'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- Policy names are identifiers, so %I ("service only"), not %L ('service only').
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'service only', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (false)',
      'service only',
      t
    );
  END LOOP;
END $$;
