-- Migration 064: Direct chat with document sub-agents in the Agent workspace.
--
-- agent_messages.doc_agent: the document sub-agent a line belongs to
-- (statement_of_accounts, biohazard_cleaning_quote, ...). Set on staff lines
-- and replies in a direct conversation with that agent (speaker 'doc_agent'),
-- on file agent lines reporting a delegated run, and on approval log lines for
-- that agent's drafts. A sub-agent's history is job_id + doc_agent.
--
-- agent_job_reads.doc_reads: {doc_agent: last_read_at} per user and job, for
-- the unread marker on each sub-agent row.

ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS doc_agent TEXT;

ALTER TABLE agent_messages DROP CONSTRAINT IF EXISTS agent_messages_doc_agent_check;
ALTER TABLE agent_messages ADD CONSTRAINT agent_messages_doc_agent_check CHECK (
  doc_agent IS NULL OR doc_agent IN (
    'statement_of_accounts', 'biohazard_cleaning_quote', 'contents_clearance_quote',
    'surface_area_cleaning_quote', 'house_survey', 'waste_disposal_manifest', 'completion_report'
  )
);

ALTER TABLE agent_messages DROP CONSTRAINT IF EXISTS agent_messages_speaker_check;
ALTER TABLE agent_messages ADD CONSTRAINT agent_messages_speaker_check
  CHECK (speaker IN ('user', 'head_agent', 'file_agent', 'doc_agent', 'system'));

CREATE INDEX IF NOT EXISTS agent_messages_job_doc_idx
  ON agent_messages (job_id, doc_agent, created_at DESC) WHERE doc_agent IS NOT NULL;

ALTER TABLE agent_job_reads ADD COLUMN IF NOT EXISTS doc_reads JSONB NOT NULL DEFAULT '{}'::jsonb;
