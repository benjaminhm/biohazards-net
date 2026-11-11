-- Migration 069: Signing links staff send themselves, opened with a passcode
-- Run in Supabase SQL Editor (safe to re-run).
--
-- Adds a second way to get a quote to a client (components/SendForSigning.tsx):
-- instead of the system emailing it, staff create a private link plus a
-- 4-character passcode and paste both into their own text or email. The client
-- opens the link (on document.<brand>.com.au where the brand has that host),
-- enters the passcode, then reads and signs as before.
--
-- delivery_method      'email' = the system emailed the link (068 behaviour).
--                      'link'  = staff were given the link and passcode to send.
-- passcode             Kept readable on purpose: staff need to be able to read
--                      it out if the client loses it. It is useless without the
--                      private link, and only the link's hash is stored.
-- passcode_attempts    Wrong tries since the last correct one.
-- passcode_locked_at   Set after 5 wrong tries. The link stays shut until staff
--                      create a new one.
-- passcode_verified_at First time the right passcode was entered (docket).
--
-- to_email becomes optional: a link sent by text may have no email with it.
-- With no email, the signed copy goes to the office inbox to pass on.

ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'email'
    CHECK (delivery_method IN ('email', 'link')),
  ADD COLUMN IF NOT EXISTS passcode TEXT,
  ADD COLUMN IF NOT EXISTS passcode_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS passcode_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS passcode_locked_at TIMESTAMPTZ;

ALTER TABLE signing_requests ALTER COLUMN to_email DROP NOT NULL;

COMMENT ON COLUMN signing_requests.delivery_method IS
  'email = the system emailed the signing link. link = staff were given the link and passcode to send themselves.';
COMMENT ON COLUMN signing_requests.passcode IS
  'Passcode the client enters to open a link sent by staff. Readable so staff can repeat it; useless without the private link, whose token is not stored.';
COMMENT ON COLUMN signing_requests.passcode_locked_at IS
  'Set after 5 wrong passcodes. The link stays shut until staff create a new one.';
