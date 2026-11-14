-- Migration 080: Quote link progress — how far a client got before they stopped
-- Run in Supabase SQL Editor (safe to re-run).
--
-- first_viewed_at already says the link was opened. These say what happened after,
-- so staff can see who is stuck and ring them (components/SendForSigning.tsx):
--
--   pdf_viewed_at     first time the client opened the quote as a PDF
--   sign_started_at   first time they pressed Accept and started their details
--   stuck_field       the last field the details check stopped them at (e.g. dateOfBirth),
--   stuck_message     what they were told, and
--   stuck_at          when. Cleared once their details pass.
--
-- Set only by the public /api/sign/[token] routes after the passcode is accepted.

ALTER TABLE signing_requests ADD COLUMN IF NOT EXISTS pdf_viewed_at   TIMESTAMPTZ;
ALTER TABLE signing_requests ADD COLUMN IF NOT EXISTS sign_started_at TIMESTAMPTZ;
ALTER TABLE signing_requests ADD COLUMN IF NOT EXISTS stuck_field     TEXT;
ALTER TABLE signing_requests ADD COLUMN IF NOT EXISTS stuck_message   TEXT;
ALTER TABLE signing_requests ADD COLUMN IF NOT EXISTS stuck_at        TIMESTAMPTZ;
