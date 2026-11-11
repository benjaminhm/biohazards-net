-- Migration 072: Several quotes on one signing link
-- Run in Supabase SQL Editor (safe to re-run). Needs 068 to 071.
--
-- One link can now carry more than one quote from the same job. The client
-- accepts or declines each, signs once, and the signature is placed on every
-- quote they accepted. One deposit is asked for, on the accepted total.
--
-- signing_request_items: one row per quote on a link.
--   position         order on the link, from 0
--   frozen_html      the quote exactly as it was when sent; the client signs this
--   doc_sha256       its fingerprint, printed on the signature docket
--   decision         pending until the link is signed or declined; accepted or
--                    declined after. Written once, together with the signature
--   signed_pdf_path  the signed copy of this quote (accepted quotes only)
--
-- signing_requests keeps its own columns as they were. Its document, title,
-- reference and frozen_html are those of the first quote on the link. Its
-- quote_total is the total of every quote while the link is open, and becomes
-- the total of the accepted quotes at the moment it is signed, so the deposit
-- (deposit_percent of quote_total) is always the deposit on what was accepted.
--
-- document_id is SET NULL on delete, as on signing_requests: deleting a saved
-- document must not destroy the record of a signature made on it.
--
-- Existing links are given one item each, so every link, old or new, is read
-- the same way. That copy is made only for links that have no items yet, so
-- running this file again changes nothing.
--
-- RLS: service-only, same pattern as 068.

CREATE TABLE IF NOT EXISTS signing_request_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       UUID NOT NULL REFERENCES signing_requests(id) ON DELETE CASCADE,
  org_id           UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id           UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL CHECK (position >= 0),
  document_id      UUID REFERENCES documents(id) ON DELETE SET NULL,

  -- What was sent
  document_type    TEXT NOT NULL,
  document_title   TEXT NOT NULL,
  reference        TEXT,
  quote_total      NUMERIC,
  frozen_html      TEXT NOT NULL,
  doc_sha256       TEXT NOT NULL,

  -- What the client chose
  decision         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (decision IN ('pending', 'accepted', 'declined')),
  decided_at       TIMESTAMPTZ,

  -- The signed copy of this quote
  signed_pdf_path  TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (request_id, position)
);

CREATE INDEX IF NOT EXISTS signing_request_items_job_idx
  ON signing_request_items(org_id, job_id);
CREATE INDEX IF NOT EXISTS signing_request_items_document_idx
  ON signing_request_items(document_id);

ALTER TABLE signing_request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON signing_request_items;
CREATE POLICY "service only" ON signing_request_items FOR ALL USING (false);

-- One item for each link that has none yet.
INSERT INTO signing_request_items (
  request_id, org_id, job_id, position, document_id,
  document_type, document_title, reference, quote_total, frozen_html, doc_sha256,
  decision, decided_at, signed_pdf_path, created_at
)
SELECT
  r.id, r.org_id, r.job_id, 0, r.document_id,
  r.document_type, r.document_title, r.reference, r.quote_total, r.frozen_html, r.doc_sha256,
  CASE r.status WHEN 'signed' THEN 'accepted' WHEN 'declined' THEN 'declined' ELSE 'pending' END,
  CASE r.status WHEN 'signed' THEN r.signed_at WHEN 'declined' THEN r.declined_at ELSE NULL END,
  r.signed_pdf_path,
  r.sent_at
FROM signing_requests r
WHERE NOT EXISTS (SELECT 1 FROM signing_request_items i WHERE i.request_id = r.id);

COMMENT ON TABLE signing_request_items IS
  'One row per quote on a signing link. The client accepts or declines each; one signature is placed on every accepted quote. Service-role access only.';
COMMENT ON COLUMN signing_request_items.frozen_html IS
  'The rendered quote exactly as it was when sent. The client signs this, not the live document.';
COMMENT ON COLUMN signing_request_items.decision IS
  'pending until the link is signed or declined; accepted or declined after. Only accepted quotes are signed and invoiced.';
COMMENT ON COLUMN signing_requests.quote_total IS
  'Inc GST. The total of every quote on the link while it is open; the total of the accepted quotes once it is signed.';
