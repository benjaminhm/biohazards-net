-- Migration 088: Co-Bid Per-OpCo Xero OAuth Connections & Per-Scope Direct Invoicing
-- Safe to re-run. Service-role-only RLS matching biohazards-net conventions.

CREATE TABLE IF NOT EXISTS cobid_opco_xero_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opco_id           UUID NOT NULL UNIQUE REFERENCES cobid_opcos(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  tenant_id         TEXT NOT NULL,
  tenant_name       TEXT NOT NULL DEFAULT '',
  access_token_enc  TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  scopes            TEXT NOT NULL DEFAULT '',
  account_code      TEXT NOT NULL DEFAULT '200',
  gst_tax_type      TEXT NOT NULL DEFAULT 'OUTPUT',
  no_gst_tax_type   TEXT NOT NULL DEFAULT 'EXEMPTOUTPUT',
  due_days          INT NOT NULL DEFAULT 7,
  invoice_mode      TEXT NOT NULL DEFAULT 'authorised' CHECK (invoice_mode IN ('authorised', 'draft')),
  status            TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'error')),
  last_error        TEXT,
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cobid_opco_xero_connections_org_idx
  ON cobid_opco_xero_connections(org_id);

ALTER TABLE cobid_opco_xero_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service only" ON cobid_opco_xero_connections;
CREATE POLICY "service only" ON cobid_opco_xero_connections FOR ALL USING (false);
REVOKE ALL ON cobid_opco_xero_connections FROM anon, authenticated;

ALTER TABLE cobid_scopes
  ADD COLUMN IF NOT EXISTS xero_deposit_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS xero_deposit_invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS xero_deposit_online_url TEXT,
  ADD COLUMN IF NOT EXISTS xero_balance_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS xero_balance_invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS xero_balance_online_url TEXT,
  ADD COLUMN IF NOT EXISTS xero_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS xero_last_error TEXT;
