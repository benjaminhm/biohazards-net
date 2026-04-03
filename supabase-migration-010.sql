-- Migration 010: messages table for 2-way SMS

CREATE TABLE IF NOT EXISTS messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id      uuid        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  direction   text        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number text        NOT NULL,
  to_number   text        NOT NULL,
  body        text        NOT NULL,
  twilio_sid  text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_job_id_idx ON messages(job_id);
CREATE INDEX IF NOT EXISTS messages_org_id_idx ON messages(org_id);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages(created_at);
