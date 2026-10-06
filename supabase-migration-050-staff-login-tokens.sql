-- Migration 050: single-use magic-link tokens for staff sign-in
-- Run in Supabase SQL Editor (safe to re-run).
--
-- Staff sign-in no longer uses Clerk. One allowlisted email can ask for a link.
-- Only the SHA-256 hash is stored, so a leaked table cannot be replayed as a
-- login. The raw token exists only in the email. Consume is a POST from the
-- confirm page so mail-scanner prefetch cannot burn the link.
--
-- RLS is on with a deny-all policy. API routes use the service role, which
-- bypasses RLS. The anon key must not read these rows.

CREATE TABLE IF NOT EXISTS staff_login_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  requested_ip  TEXT NOT NULL DEFAULT '',
  requested_user_agent TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_login_tokens_hash_len CHECK (char_length(token_hash) BETWEEN 32 AND 128)
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_login_tokens_hash_uniq
  ON staff_login_tokens(token_hash);

CREATE INDEX IF NOT EXISTS staff_login_tokens_email_idx
  ON staff_login_tokens(email, created_at DESC);

CREATE INDEX IF NOT EXISTS staff_login_tokens_ip_idx
  ON staff_login_tokens(requested_ip, created_at DESC);

ALTER TABLE public.staff_login_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON public.staff_login_tokens;
CREATE POLICY "service only" ON public.staff_login_tokens FOR ALL USING (false);

COMMENT ON TABLE staff_login_tokens IS
  'Single-use staff magic-link tokens. Only token_hash is stored. Service role only.';
