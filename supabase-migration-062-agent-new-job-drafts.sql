-- Migration 062: the head agent can propose a new job.
--
-- A 'new_job' draft has no job yet, so agent_drafts.job_id may be NULL for
-- that kind only. Approving it creates the job and sets job_id on the draft.
-- RLS unchanged (service-role only).

ALTER TABLE agent_drafts ALTER COLUMN job_id DROP NOT NULL;

ALTER TABLE agent_drafts DROP CONSTRAINT IF EXISTS agent_drafts_kind_check;
ALTER TABLE agent_drafts ADD CONSTRAINT agent_drafts_kind_check
  CHECK (kind IN ('field', 'note', 'status', 'document', 'new_job'));

ALTER TABLE agent_drafts DROP CONSTRAINT IF EXISTS agent_drafts_job_required;
ALTER TABLE agent_drafts ADD CONSTRAINT agent_drafts_job_required
  CHECK (job_id IS NOT NULL OR kind = 'new_job');

CREATE INDEX IF NOT EXISTS agent_drafts_new_job_pending_idx ON agent_drafts (org_id) WHERE status = 'pending' AND kind = 'new_job';
