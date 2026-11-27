-- Migration 089: Co-Bid Structured Quote Types (BCQ/SACQ/CCQ/MTQ), OpCo Bid Links & Separate Entity Docs
-- Safe to re-run. Service-role-only RLS matching biohazards-net conventions.

ALTER TABLE cobid_scopes
  ADD COLUMN IF NOT EXISTS quote_type TEXT NOT NULL DEFAULT 'custom'
    CHECK (quote_type IN ('bcq', 'sacq', 'ccq', 'mtq', 'custom')),
  ADD COLUMN IF NOT EXISTS independent_job_ref TEXT,
  ADD COLUMN IF NOT EXISTS structured_quote_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS bid_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS bid_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS doc_token TEXT,
  ADD COLUMN IF NOT EXISTS doc_token_hash TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS doc_snapshot_html TEXT,
  ADD COLUMN IF NOT EXISTS doc_status TEXT NOT NULL DEFAULT 'not_sent'
    CHECK (doc_status IN ('not_sent', 'open', 'signed', 'declined', 'voided')),
  ADD COLUMN IF NOT EXISTS doc_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS doc_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS doc_declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS doc_decline_reason TEXT;

CREATE INDEX IF NOT EXISTS cobid_scopes_bid_token_idx
  ON cobid_scopes(bid_token)
  WHERE bid_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS cobid_scopes_doc_token_hash_idx
  ON cobid_scopes(doc_token_hash)
  WHERE doc_token_hash IS NOT NULL;

ALTER TABLE cobid_workspaces
  ADD COLUMN IF NOT EXISTS shared_photo_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS package_token TEXT,
  ADD COLUMN IF NOT EXISTS package_token_hash TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS package_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS cobid_workspaces_package_token_hash_idx
  ON cobid_workspaces(package_token_hash)
  WHERE package_token_hash IS NOT NULL;
