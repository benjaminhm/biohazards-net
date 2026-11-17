-- Migration 082: client photo tracking (tracking.<brand>.com.au).
--
-- A client signs in with a code sent to their mobile (or email) and follows the
-- job's photos as a timeline. Nothing shows until staff turn the feed on for the
-- job; progress and after photos then show by default and staff can hide or
-- show any single photo. Clients can comment; admins reply.

-- Per-job switch. Off until staff turn it on.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_feed_enabled BOOLEAN NOT NULL DEFAULT false;

-- Per-photo override: null follows the default rule (lib/tracking/feed.ts),
-- true always shows, false always hides. client_caption is what the client
-- reads under the post; the staff caption stays internal.
ALTER TABLE photos ADD COLUMN IF NOT EXISTS client_visible BOOLEAN;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS client_caption TEXT NOT NULL DEFAULT '';

-- Who may view a job's feed. identity is the E.164 mobile or lower-case email
-- the person signs in with; one person can follow several jobs.
CREATE TABLE IF NOT EXISTS job_viewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  added_by_name TEXT NOT NULL DEFAULT '',
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT job_viewers_contact CHECK (mobile <> '' OR email <> ''),
  CONSTRAINT job_viewers_name_len CHECK (char_length(name) <= 120),
  CONSTRAINT job_viewers_mobile_len CHECK (char_length(mobile) <= 20),
  CONSTRAINT job_viewers_email_len CHECK (char_length(email) <= 320)
);

CREATE INDEX IF NOT EXISTS job_viewers_job_idx ON job_viewers(job_id);
CREATE INDEX IF NOT EXISTS job_viewers_mobile_idx ON job_viewers(mobile) WHERE mobile <> '';
CREATE INDEX IF NOT EXISTS job_viewers_email_idx ON job_viewers(email) WHERE email <> '';

-- Sign-in codes. Only the SHA-256 of the code is stored.
CREATE TABLE IF NOT EXISTS tracking_login_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity TEXT NOT NULL,
  trading_name TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  requested_ip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rate-limit counters read (identity, created_at) and (ip, created_at).
CREATE INDEX IF NOT EXISTS tracking_login_codes_identity_idx ON tracking_login_codes(identity, created_at DESC);
CREATE INDEX IF NOT EXISTS tracking_login_codes_ip_idx ON tracking_login_codes(requested_ip, created_at DESC);

-- Comments on a post. A post is a group of photos worked out at read time, so a
-- comment is pinned to the photo that led the post when it was written.
CREATE TABLE IF NOT EXISTS job_feed_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('client', 'staff')),
  viewer_id UUID REFERENCES job_viewers(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT job_feed_comments_body_len CHECK (char_length(body) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS job_feed_comments_job_idx ON job_feed_comments(job_id, created_at);

-- Service-only: the app reads and writes these tables with the service role.
ALTER TABLE job_viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_login_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_feed_comments ENABLE ROW LEVEL SECURITY;
