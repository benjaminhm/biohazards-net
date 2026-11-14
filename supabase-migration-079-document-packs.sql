-- Migration 079: Statement packs — send a Statement of Accounts with its CDR and report by private link
-- Run in Supabase SQL Editor (safe to re-run).
--
-- One row each time staff send a client a statement pack (components/SendStatementPack.tsx,
-- /api/document-packs, /pack/[token]). The link opens on the Statement of Accounts, which
-- links on to the other documents staff put in the pack. View and download only: nothing
-- is signed or accepted here.
--
-- Each document is frozen as it was sent (document_pack_items.frozen_html), so later
-- edits to the job do not change what the client was shown.
--
-- token_hash is the SHA-256 of the random token in the client's link; the token itself
-- is never stored. A link staff send themselves carries a passcode (five wrong tries
-- locks it), same as quote links.
--
-- RLS: service-only, same pattern as 068. Staff access goes through /api/document-packs
-- after guardFullAccessStaff; the public pack routes look a row up by token_hash only.

CREATE TABLE IF NOT EXISTS document_packs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id                UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  -- The statement the pack was sent from.
  document_id           UUID REFERENCES documents(id) ON DELETE SET NULL,
  token_hash            TEXT NOT NULL UNIQUE,
  status                TEXT NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent', 'viewed', 'voided')),

  trading_name          TEXT,
  brand_label           TEXT NOT NULL,
  from_address          TEXT NOT NULL,
  reply_to              TEXT,
  to_email              TEXT,
  to_name               TEXT NOT NULL,
  subject               TEXT NOT NULL DEFAULT '',
  message               TEXT NOT NULL DEFAULT '',
  delivery_method       TEXT NOT NULL DEFAULT 'link' CHECK (delivery_method IN ('email', 'link')),

  passcode              TEXT,
  passcode_attempts     INTEGER NOT NULL DEFAULT 0,
  passcode_verified_at  TIMESTAMPTZ,
  passcode_locked_at    TIMESTAMPTZ,

  sent_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by               TEXT,
  sent_by_name          TEXT,
  expires_at            TIMESTAMPTZ NOT NULL,
  first_viewed_at       TIMESTAMPTZ,
  last_viewed_at        TIMESTAMPTZ,
  voided_at             TIMESTAMPTZ,
  voided_by             TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_packs_job_idx ON document_packs(org_id, job_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS document_packs_document_idx ON document_packs(document_id);

CREATE TABLE IF NOT EXISTS document_pack_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id         UUID NOT NULL REFERENCES document_packs(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- 0 is the Statement of Accounts; the others follow in the order staff chose.
  position        INTEGER NOT NULL,
  document_id     UUID REFERENCES documents(id) ON DELETE SET NULL,
  document_type   TEXT NOT NULL,
  document_title  TEXT NOT NULL,
  reference       TEXT,
  frozen_html     TEXT NOT NULL,
  -- The PDF, made the first time the client downloads it.
  pdf_path        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pack_id, position)
);

CREATE INDEX IF NOT EXISTS document_pack_items_document_idx ON document_pack_items(document_id);

ALTER TABLE document_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_pack_items ENABLE ROW LEVEL SECURITY;
