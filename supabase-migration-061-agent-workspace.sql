-- Migration 061: Agent workspace — saved chat, agent drafts, read markers.
--
-- agent_messages: one row per visible chat line. thread_id is the owner's
-- staff user id (one running thread per user); it is NULL for posts the
-- pipeline makes into a job's feed (calls, website forms). job_id NULL means a
-- head agent line; set means the line belongs to that job's history.
-- content is {text, draft_ids?, handover?}.
--
-- agent_drafts: changes an agent proposed. Nothing reaches the job until staff
-- approve. A human edit to the same field marks a pending draft 'stale'.
--
-- agent_job_reads: when each user last opened a job in the workspace; drives
-- the unread markers.
--
-- All three are service-role only: RLS on, no policies.

CREATE TABLE IF NOT EXISTS agent_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  thread_id  TEXT,
  job_id     UUID REFERENCES jobs(id) ON DELETE CASCADE,
  speaker    TEXT NOT NULL CHECK (speaker IN ('user', 'head_agent', 'file_agent', 'system')),
  author     TEXT NOT NULL DEFAULT '',
  content    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_messages_thread_idx ON agent_messages (org_id, thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_messages_job_idx ON agent_messages (job_id, created_at DESC);

ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_messages FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS agent_drafts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  message_id  UUID REFERENCES agent_messages(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('field', 'note', 'status', 'document')),
  target_path TEXT NOT NULL DEFAULT '',
  before      JSONB,
  proposed    JSONB,
  summary     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'stale')),
  created_by  TEXT NOT NULL DEFAULT '',
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_drafts_job_pending_idx ON agent_drafts (job_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS agent_drafts_org_pending_idx ON agent_drafts (org_id) WHERE status = 'pending';

ALTER TABLE agent_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_drafts FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS agent_job_reads (
  user_id      TEXT NOT NULL,
  job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, job_id)
);

ALTER TABLE agent_job_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_job_reads FROM anon, authenticated;
