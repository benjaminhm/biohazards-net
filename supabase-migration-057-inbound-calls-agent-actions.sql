-- Inbound call pipeline (VoIP webhook → transcript → clean → head agent → file agent)
-- and the agent action ledger.
--
-- Every stage keeps its own output on inbound_calls so a bad field can be traced
-- back to the stage that produced it. Every write an agent makes goes into
-- agent_actions with the value before and after.
--
-- Agents write internal data only. Nothing here sends anything to a client.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS job_description TEXT NOT NULL DEFAULT '';

-- Which org a dialled number belongs to. Numbers are E.164.
CREATE TABLE IF NOT EXISTS voip_numbers (
  number TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inbound_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'voiceline',
  provider_call_id TEXT NOT NULL,
  caller_number TEXT NOT NULL DEFAULT '',
  called_number TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ,
  duration_s INTEGER,
  recording_url TEXT NOT NULL DEFAULT '',

  -- Stage outputs, in pipeline order.
  payload_raw JSONB NOT NULL,
  transcript_raw TEXT,
  transcript_source TEXT,            -- 'provider' | 'openai'
  transcript_clean TEXT,
  clean_changes JSONB,               -- [{ from, to, reason }]
  clean_unclear JSONB,               -- [string]
  extraction JSONB,                  -- head agent output
  extraction_model TEXT,
  validation JSONB,                  -- { issues: [], decision, matched_job_id }
  filed JSONB,                       -- file agent summary

  -- received | transcribed | cleaned | extracted | filed | needs_review | failed
  status TEXT NOT NULL DEFAULT 'received',
  error TEXT,
  error_stage TEXT,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS inbound_calls_provider_call_idx
  ON inbound_calls (provider, provider_call_id);
CREATE INDEX IF NOT EXISTS inbound_calls_org_created_idx
  ON inbound_calls (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inbound_calls_job_idx
  ON inbound_calls (job_id);

CREATE TABLE IF NOT EXISTS agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  agent TEXT NOT NULL,               -- 'head_agent' | 'file_agent' | 'job_assistant'
  trigger TEXT NOT NULL,             -- e.g. 'inbound_call:<id>'
  action TEXT NOT NULL,              -- e.g. 'create_job', 'set_contact_fields', 'draft_quote'
  target_table TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  target_path TEXT NOT NULL DEFAULT '', -- e.g. 'assessment_data.contents_clearance_quote'
  before JSONB,
  after JSONB,
  note TEXT NOT NULL DEFAULT '',
  -- applied | needs_review | undone | failed
  status TEXT NOT NULL DEFAULT 'applied',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_actions_org_created_idx
  ON agent_actions (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_actions_trigger_idx
  ON agent_actions (trigger);
CREATE INDEX IF NOT EXISTS agent_actions_job_idx
  ON agent_actions (job_id);

ALTER TABLE voip_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;
