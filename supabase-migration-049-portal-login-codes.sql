-- Migration 049: six-digit sign-in codes for the trade accounts portal
-- Run in Supabase SQL Editor (safe to re-run).
--
-- Why:
--   Corporate mail gateways (Microsoft Defender Safe Links, Mimecast, Proofpoint)
--   rewrite every URL in an inbound email, and plenty of company policies tell
--   staff not to click links in external mail at all. A magic link is then the
--   one credential the client cannot use. A code they type into a browser they
--   opened themselves survives all of that, because nothing in the mail chain
--   can break a number.
--
--   The code rides on the existing token row rather than a new table: it is the
--   same credential delivered two ways, so it must expire and burn as one thing.
--   Two rows would let a client use the code after the link had been consumed.
--
-- Only the hash is stored, matching token_hash. Be clear-eyed about what that
-- buys for six digits though: SHA-256 over a million candidates is reversible in
-- under a second, so unlike token_hash this is hygiene, not protection against a
-- leaked snapshot. The short expiry and single use are what limit a leak. Key
-- the hash with PORTAL_SESSION_SECRET if that ever stops being good enough.
--
-- Every statement is ADD COLUMN IF NOT EXISTS on a column with a default, so the
-- SQL editor's "destructive operations" warning is a false positive.

ALTER TABLE client_portal_login_tokens
  ADD COLUMN IF NOT EXISTS code_hash TEXT NOT NULL DEFAULT '',
  -- Per-row ceiling on wrong guesses. Six digits is only a million
  -- combinations, so the attempt cap — not the code length — is what makes this
  -- safe. With the existing five-issues-per-email-per-hour limit an attacker
  -- gets 25 guesses an hour.
  ADD COLUMN IF NOT EXISTS code_attempts SMALLINT NOT NULL DEFAULT 0,
  -- 'self_service' (client asked at the login form) or 'staff_invite' (we sent
  -- it). Drives how long the credential lives, and reads honestly in the audit
  -- trail — until now the invite route smuggled this into requested_user_agent.
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'self_service';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_portal_login_tokens_purpose_chk'
  ) THEN
    ALTER TABLE client_portal_login_tokens
      ADD CONSTRAINT client_portal_login_tokens_purpose_chk
      CHECK (purpose IN ('self_service', 'staff_invite'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_portal_login_tokens_code_len'
  ) THEN
    ALTER TABLE client_portal_login_tokens
      ADD CONSTRAINT client_portal_login_tokens_code_len
      CHECK (char_length(code_hash) <= 128);
  END IF;
END $$;

-- Code sign-in looks up live credentials by the email that was typed, since the
-- code alone is not a credential — it is only meaningful paired with the email.
--
-- Partial on unconsumed rows: burnt credentials are the overwhelming majority of
-- this table over time and no lookup ever wants them. Plain email_at_issue
-- rather than lower(), because the column is only ever written lowercased and
-- the query compares it directly — an expression index would be ignored.
CREATE INDEX IF NOT EXISTS client_portal_login_tokens_code_lookup_idx
  ON client_portal_login_tokens(email_at_issue, expires_at)
  WHERE consumed_at IS NULL;

-- Rows issued before this migration have no code and can only be used via their
-- link. Nothing to backfill: '' never matches a hashed guess.
COMMENT ON COLUMN client_portal_login_tokens.code_hash IS
  'SHA-256 of the six-digit sign-in code shown in the email. Empty for rows issued before migration 049, which are link-only.';

COMMENT ON COLUMN client_portal_login_tokens.purpose IS
  'self_service or staff_invite. Sets the expiry: an hour for a link the client just asked for, a week for an invite they may not read until they are back at their desk.';
