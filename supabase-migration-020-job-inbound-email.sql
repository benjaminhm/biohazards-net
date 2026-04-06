-- Per-job inbound email (pilot: orgs listed in JOB_INBOUND_EMAIL_ORG_SLUGS).
-- Token in jobs.inbound_email_token; address = {token}@{INBOUND_EMAIL_DOMAIN}

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS inbound_email_token text UNIQUE;

COMMENT ON COLUMN jobs.inbound_email_token IS 'Opaque local-part for job-specific inbound email; only set for pilot orgs.';

CREATE TABLE IF NOT EXISTS job_email_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id              uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  direction           text NOT NULL DEFAULT 'inbound' CHECK (direction = 'inbound'),
  from_address        text NOT NULL,
  to_address          text NOT NULL,
  subject             text,
  body_text           text NOT NULL DEFAULT '',
  provider_message_id text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_email_messages_job_id_idx ON job_email_messages(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_email_messages_org_id_idx ON job_email_messages(org_id);
