-- Migration 063: staff flags pinned on a job.
--
-- job_flags: short notices pinned at the top of the job (Classic job page and
-- the Agent workspace right panel) until staff resolve them.
--   source 'agent'  — drafted by the file agent (agent_drafts kind 'flag'),
--                     created when staff approve the card.
--   source 'system' — raised automatically for document conflicts (duplicate
--                     references, two of a one-per-job document). dedupe_key
--                     stops the same conflict being flagged twice.
--   source 'staff'  — added by staff.
-- RLS on, no policies: service-role API routes only, scoped by org_id.

CREATE TABLE IF NOT EXISTS job_flags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  severity     text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'urgent')),
  message      text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  source       text NOT NULL CHECK (source IN ('agent', 'staff', 'system')),
  dedupe_key   text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  text
);

CREATE INDEX IF NOT EXISTS job_flags_job_open_idx ON job_flags (org_id, job_id) WHERE resolved_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS job_flags_dedupe_idx ON job_flags (job_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE job_flags ENABLE ROW LEVEL SECURITY;

ALTER TABLE agent_drafts DROP CONSTRAINT IF EXISTS agent_drafts_kind_check;
ALTER TABLE agent_drafts ADD CONSTRAINT agent_drafts_kind_check
  CHECK (kind IN ('field', 'note', 'status', 'document', 'new_job', 'flag'));
