-- Migration 087: Co-Bid OpCo Onboarding, Compliance Vault & Approval Pipeline
-- Safe to re-run. Service-role-only RLS matching biohazards-net conventions.

ALTER TABLE cobid_opcos
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (onboarding_status IN ('invited', 'in_progress', 'pending_review', 'approved', 'suspended')),
  ADD COLUMN IF NOT EXISTS onboarding_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS onboarding_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legal_entity_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS trading_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS acn TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gst_registered BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS logo_path TEXT,
  ADD COLUMN IF NOT EXISTS service_regions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS allowed_quote_types JSONB NOT NULL DEFAULT '["bcq","sacq","custom"]'::jsonb,
  ADD COLUMN IF NOT EXISTS terms_and_conditions TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS deed_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deed_signed_by TEXT,
  ADD COLUMN IF NOT EXISTS deed_signed_title TEXT,
  ADD COLUMN IF NOT EXISTS deed_signed_ip TEXT,
  ADD COLUMN IF NOT EXISTS deed_signed_ua TEXT,
  ADD COLUMN IF NOT EXISTS deed_audit_hash TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS review_notes TEXT;

CREATE INDEX IF NOT EXISTS cobid_opcos_onboarding_token_idx
  ON cobid_opcos(onboarding_token)
  WHERE onboarding_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS cobid_opco_compliance_docs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opco_id           UUID NOT NULL REFERENCES cobid_opcos(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  doc_type          TEXT NOT NULL CHECK (doc_type IN ('public_liability', 'workcover', 'trade_licence', 'hazmat_licence', 'swms', 'other')),
  title             TEXT NOT NULL DEFAULT '',
  document_number   TEXT NOT NULL DEFAULT '',
  issuer_or_insurer TEXT NOT NULL DEFAULT '',
  coverage_amount   TEXT NOT NULL DEFAULT '',
  expires_at        DATE,
  file_path         TEXT NOT NULL,
  file_name         TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_at       TIMESTAMPTZ,
  verified_by       TEXT,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cobid_opco_compliance_docs_opco_idx
  ON cobid_opco_compliance_docs(opco_id, doc_type);

ALTER TABLE cobid_opco_compliance_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service only" ON cobid_opco_compliance_docs;
CREATE POLICY "service only" ON cobid_opco_compliance_docs FOR ALL USING (false);
REVOKE ALL ON cobid_opco_compliance_docs FROM anon, authenticated;
