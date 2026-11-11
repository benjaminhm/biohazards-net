-- Migration 068: Send Quote for signature — signing requests + signed PDF bucket
-- Run in Supabase SQL Editor (safe to re-run).
--
-- One row each time staff send a saved quote to a client to sign
-- (components/SendForSigning.tsx, /api/signing, /sign/[token]).
--
-- The row is the file record of the send (who, when, to whom, from which brand
-- address, the message) and the evidence for the signature docket: the exact
-- document HTML as sent, its SHA-256 fingerprint, and when it was viewed,
-- consented to and signed, from which IP and device.
--
-- token_hash is the SHA-256 of the random token in the client's private link.
-- The token itself is never stored, so a database read cannot be turned into a
-- working signing link.
--
-- document_id is SET NULL on delete so deleting a saved document does not
-- destroy the record of a signature that was made on it.
--
-- RLS: service-only, same pattern as 067. Staff access goes through
-- /api/signing after guardFullAccessStaff; the public signing routes look a row
-- up by token_hash only.

CREATE TABLE IF NOT EXISTS signing_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id             UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  document_id        UUID REFERENCES documents(id) ON DELETE SET NULL,
  token_hash         TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'sent'
                     CHECK (status IN ('sent', 'viewed', 'signed', 'declined', 'voided')),

  -- What was sent
  document_type      TEXT NOT NULL,
  document_title     TEXT NOT NULL,
  reference          TEXT,
  quote_total        NUMERIC,
  frozen_html        TEXT NOT NULL,
  doc_sha256         TEXT NOT NULL,

  -- How it was sent
  trading_name       TEXT,
  brand_label        TEXT NOT NULL,
  from_address       TEXT NOT NULL,
  reply_to           TEXT,
  to_email           TEXT NOT NULL,
  to_name            TEXT NOT NULL,
  subject            TEXT NOT NULL,
  message            TEXT NOT NULL,
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by            TEXT,
  sent_by_name       TEXT,
  expires_at         TIMESTAMPTZ NOT NULL,

  -- What the client did
  first_viewed_at    TIMESTAMPTZ,
  consented_at       TIMESTAMPTZ,
  signed_at          TIMESTAMPTZ,
  signer_name        TEXT,
  signature_png      TEXT,
  signature_method   TEXT CHECK (signature_method IS NULL OR signature_method IN ('drawn', 'typed')),
  signer_ip          TEXT,
  signer_user_agent  TEXT,
  declined_at        TIMESTAMPTZ,
  decline_reason     TEXT,
  voided_at          TIMESTAMPTZ,
  voided_by          TEXT,

  -- Delivery of the signed copy
  signed_pdf_path    TEXT,
  delivered_at       TIMESTAMPTZ,
  delivery_error     TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signing_requests_job_idx
  ON signing_requests(org_id, job_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS signing_requests_document_idx
  ON signing_requests(document_id);

ALTER TABLE signing_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON signing_requests;
CREATE POLICY "service only" ON signing_requests FOR ALL USING (false);

COMMENT ON TABLE signing_requests IS
  'One row per quote sent to a client for electronic signature. Holds the send record, the document exactly as sent, and the signing evidence for the signature docket. Service-role access only.';
COMMENT ON COLUMN signing_requests.token_hash IS
  'SHA-256 of the random token in the client''s signing link. The token itself is not stored.';
COMMENT ON COLUMN signing_requests.frozen_html IS
  'The rendered document exactly as it was when sent. The client signs this, not the live document.';
COMMENT ON COLUMN signing_requests.doc_sha256 IS
  'SHA-256 of frozen_html, printed on the signature docket as the document fingerprint.';

-- Signed PDFs. Private: served only through /api/signing/[id]/pdf (staff) and
-- /api/sign/[token]/pdf (the signer's own link).
INSERT INTO storage.buckets (id, name, public)
VALUES ('signed-documents', 'signed-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;
