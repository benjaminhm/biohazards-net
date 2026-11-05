-- Migration 060: Xero connection per org and one Xero invoice per job.
--
-- xero_connections: one Xero organisation per app org. Tokens are AES-256-GCM
-- encrypted by the app (env XERO_TOKEN_KEY) before they are stored.
-- xero_job_invoices: the single draft ACCREC invoice for a job. Every accepted
-- quote on the job becomes one line on it. A sync takes sync_lock_until first,
-- so two acceptances landing together cannot create two invoices.
-- lines_hash is the last set of lines synced or flagged for review, so the
-- same change is not flagged twice.
--
-- Both tables are service-role only: RLS on, no policies.

CREATE TABLE IF NOT EXISTS xero_connections (
  org_id            UUID PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  tenant_id         TEXT NOT NULL,
  tenant_name       TEXT NOT NULL DEFAULT '',
  access_token_enc  TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  scopes            TEXT NOT NULL DEFAULT '',
  settings          JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected_by      TEXT NOT NULL DEFAULT '',
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE xero_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xero_connections FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS xero_job_invoices (
  job_id              UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  org_id              UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  xero_invoice_id     TEXT,
  xero_invoice_number TEXT NOT NULL DEFAULT '',
  xero_contact_id     TEXT NOT NULL DEFAULT '',
  xero_status         TEXT NOT NULL DEFAULT 'CLAIMED',
  document_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  lines_hash          TEXT NOT NULL DEFAULT '',
  total               NUMERIC,
  last_error          TEXT NOT NULL DEFAULT '',
  last_synced_at      TIMESTAMPTZ,
  sync_lock_until     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS xero_job_invoices_org_idx ON xero_job_invoices (org_id);

ALTER TABLE xero_job_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xero_job_invoices FROM anon, authenticated;
