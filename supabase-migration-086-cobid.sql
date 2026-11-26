-- Migration 086: Co-Bid Remediation Settlement Workspace (co-sharing SaaS)
-- Run in Supabase SQL Editor (safe to re-run).
--
-- Cleanly namespaced tables (cobid_*) scoped by org_id, with service-only RLS
-- matching the rest of biohazards-net (migrations 023 & 046). No existing
-- biohazards-net tables are modified; linked_job_id is an optional FK ready
-- for future step-by-step wiring.

-- 1. OpCo / Contractor Directory (editable per org)
CREATE TABLE IF NOT EXISTS cobid_opcos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  key                   TEXT NOT NULL,
  trade_category        TEXT NOT NULL,
  company_name          TEXT NOT NULL,
  abn                   TEXT NOT NULL DEFAULT '',
  licence_number        TEXT NOT NULL DEFAULT '',
  monogram              TEXT NOT NULL DEFAULT 'OP',
  contact_name          TEXT NOT NULL DEFAULT '',
  contact_email         TEXT NOT NULL DEFAULT '',
  bank_name             TEXT NOT NULL DEFAULT '',
  bsb                   TEXT NOT NULL DEFAULT '',
  account_number        TEXT NOT NULL DEFAULT '',
  pay_id                TEXT NOT NULL DEFAULT '',
  default_deposit_pct   INT NOT NULL DEFAULT 30,
  default_scope_summary TEXT NOT NULL DEFAULT '',
  default_deliverables  JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_exclusions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_line_items    JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_milestones    JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_compliance_docs JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, key)
);

-- 2. Job Workspaces
CREATE TABLE IF NOT EXISTS cobid_workspaces (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  linked_job_id     UUID REFERENCES jobs(id) ON DELETE SET NULL,
  reference         TEXT NOT NULL,
  title             TEXT NOT NULL,
  property_address  TEXT NOT NULL,
  suburb_state      TEXT NOT NULL DEFAULT '',
  lead_source       TEXT NOT NULL DEFAULT '',
  lead_source_type  TEXT NOT NULL DEFAULT 'Direct Client',
  created_at_label  TEXT NOT NULL DEFAULT '',
  client_name       TEXT NOT NULL,
  client_role       TEXT NOT NULL DEFAULT 'Property Owner',
  client_email      TEXT NOT NULL DEFAULT '',
  client_phone      TEXT NOT NULL DEFAULT '',
  settlement_rail   TEXT NOT NULL DEFAULT 'direct_to_opco',
  coordinator_name  TEXT NOT NULL DEFAULT '',
  site_access_notes TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, reference)
);

-- 3. Per-OpCo Independent Scopes inside a Workspace
CREATE TABLE IF NOT EXISTS cobid_scopes (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES cobid_workspaces(id) ON DELETE CASCADE,
  org_id                   UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  directory_opco_id        UUID REFERENCES cobid_opcos(id) ON DELETE SET NULL,
  sequence_order           INT NOT NULL DEFAULT 1,
  depends_on_scope_id      UUID REFERENCES cobid_scopes(id) ON DELETE SET NULL,
  trade_category           TEXT NOT NULL,
  company_name             TEXT NOT NULL,
  abn                      TEXT NOT NULL DEFAULT '',
  licence_number           TEXT NOT NULL DEFAULT '',
  monogram                 TEXT NOT NULL DEFAULT 'OP',
  contact_name             TEXT NOT NULL DEFAULT '',
  contact_email            TEXT NOT NULL DEFAULT '',
  bank_name                TEXT NOT NULL DEFAULT '',
  bsb                      TEXT NOT NULL DEFAULT '',
  account_number           TEXT NOT NULL DEFAULT '',
  pay_id                   TEXT NOT NULL DEFAULT '',
  deposit_percent          INT NOT NULL DEFAULT 30,
  scope_summary            TEXT NOT NULL DEFAULT '',
  scope_deliverables       JSONB NOT NULL DEFAULT '[]'::jsonb,
  exclusions               JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope_status             TEXT NOT NULL DEFAULT 'draft',
  revision_note            TEXT,
  contractor_approved_at   TEXT,
  agreement_ref            TEXT NOT NULL,
  agreement_status         TEXT NOT NULL DEFAULT 'not_ready',
  agreement_sent_at        TEXT,
  client_signed_at         TEXT,
  client_signed_by         TEXT,
  agreement_audit_hash     TEXT,
  client_signed_ip         TEXT,
  client_signed_user_agent TEXT,
  deposit_status           TEXT NOT NULL DEFAULT 'pending',
  deposit_paid_at          TEXT,
  deposit_payment_ref      TEXT,
  deposit_method           TEXT,
  balance_status           TEXT NOT NULL DEFAULT 'pending',
  balance_paid_at          TEXT,
  balance_payment_ref      TEXT,
  balance_invoice_ref      TEXT NOT NULL,
  completion_signed_off    BOOLEAN NOT NULL DEFAULT false,
  completion_signed_at     TEXT,
  completion_notes         TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Line Items per Scope
CREATE TABLE IF NOT EXISTS cobid_line_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id    UUID NOT NULL REFERENCES cobid_scopes(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  description TEXT NOT NULL,
  unit        TEXT NOT NULL DEFAULT 'Allow',
  qty         DOUBLE PRECISION NOT NULL DEFAULT 1,
  unit_price  DOUBLE PRECISION NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT 'General',
  sort_order  INT NOT NULL DEFAULT 0
);

-- 5. Variation Orders per Scope
CREATE TABLE IF NOT EXISTS cobid_variations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id      UUID NOT NULL REFERENCES cobid_scopes(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  reference     TEXT NOT NULL,
  title         TEXT NOT NULL,
  reason        TEXT NOT NULL DEFAULT '',
  amount_ex_gst DOUBLE PRECISION NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending_coordinator',
  created_at_label TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL DEFAULT '',
  approved_at   TEXT,
  approved_by   TEXT,
  inserted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Sequenced Milestones per Scope
CREATE TABLE IF NOT EXISTS cobid_milestones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id         UUID NOT NULL REFERENCES cobid_scopes(id) ON DELETE CASCADE,
  org_id           UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  target_day       TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'pending',
  completed_at     TEXT,
  is_handover_gate BOOLEAN NOT NULL DEFAULT false,
  sort_order       INT NOT NULL DEFAULT 0
);

-- 7. Site Progress & Photo Logs per Scope
CREATE TABLE IF NOT EXISTS cobid_progress_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id        UUID NOT NULL REFERENCES cobid_scopes(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  timestamp_label TEXT NOT NULL DEFAULT '',
  author          TEXT NOT NULL DEFAULT '',
  summary         TEXT NOT NULL DEFAULT '',
  stage           TEXT NOT NULL DEFAULT 'during',
  photo_label     TEXT,
  photo_tone      TEXT,
  photo_url       TEXT,
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Compliance Documents per Scope
CREATE TABLE IF NOT EXISTS cobid_compliance_docs (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id  UUID NOT NULL REFERENCES cobid_scopes(id) ON DELETE CASCADE,
  org_id    UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT 'Pending completion',
  issued_at TEXT NOT NULL DEFAULT '—',
  status    TEXT NOT NULL DEFAULT 'pending',
  file_url  TEXT
);

-- 9. Magic-Link Workspace Invites (ring-fenced per role / OpCo)
CREATE TABLE IF NOT EXISTS cobid_invites (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  workspace_id   UUID NOT NULL REFERENCES cobid_workspaces(id) ON DELETE CASCADE,
  token          TEXT NOT NULL UNIQUE,
  email          TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  role_type      TEXT NOT NULL CHECK (role_type IN ('coordinator', 'contractor', 'client')),
  scope_id       UUID REFERENCES cobid_scopes(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  expires_at     TIMESTAMPTZ NOT NULL,
  accepted_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Workspace Messages (shared_ops or scope_id private channel)
CREATE TABLE IF NOT EXISTS cobid_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES cobid_workspaces(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL DEFAULT 'shared_ops',
  timestamp_label   TEXT NOT NULL DEFAULT '',
  sender_name       TEXT NOT NULL DEFAULT '',
  sender_role_label TEXT NOT NULL DEFAULT '',
  body              TEXT NOT NULL,
  inserted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Tamper-Evident Audit Events
CREATE TABLE IF NOT EXISTS cobid_audit_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES cobid_workspaces(id) ON DELETE CASCADE,
  org_id               UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  timestamp_label      TEXT NOT NULL DEFAULT '',
  actor                TEXT NOT NULL DEFAULT '',
  category             TEXT NOT NULL DEFAULT 'workspace',
  summary              TEXT NOT NULL,
  restricted_to_scope_id UUID REFERENCES cobid_scopes(id) ON DELETE SET NULL,
  inserted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS cobid_opcos_org_idx            ON cobid_opcos(org_id);
CREATE INDEX IF NOT EXISTS cobid_workspaces_org_idx       ON cobid_workspaces(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cobid_scopes_workspace_idx     ON cobid_scopes(workspace_id, sequence_order);
CREATE INDEX IF NOT EXISTS cobid_line_items_scope_idx     ON cobid_line_items(scope_id, sort_order);
CREATE INDEX IF NOT EXISTS cobid_variations_scope_idx     ON cobid_variations(scope_id, inserted_at DESC);
CREATE INDEX IF NOT EXISTS cobid_milestones_scope_idx     ON cobid_milestones(scope_id, sort_order);
CREATE INDEX IF NOT EXISTS cobid_progress_logs_scope_idx  ON cobid_progress_logs(scope_id, inserted_at DESC);
CREATE INDEX IF NOT EXISTS cobid_compliance_docs_scope_idx ON cobid_compliance_docs(scope_id);
CREATE INDEX IF NOT EXISTS cobid_invites_workspace_idx    ON cobid_invites(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cobid_invites_token_idx        ON cobid_invites(token);
CREATE INDEX IF NOT EXISTS cobid_messages_workspace_idx   ON cobid_messages(workspace_id, inserted_at ASC);
CREATE INDEX IF NOT EXISTS cobid_audit_workspace_idx      ON cobid_audit_events(workspace_id, inserted_at DESC);

-- Service-only RLS (matching biohazards-net conventions: all reads/writes go via createServiceClient())
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'cobid_opcos',
      'cobid_workspaces',
      'cobid_scopes',
      'cobid_line_items',
      'cobid_variations',
      'cobid_milestones',
      'cobid_progress_logs',
      'cobid_compliance_docs',
      'cobid_invites',
      'cobid_messages',
      'cobid_audit_events'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "service only" ON %I', tbl);
    EXECUTE format('CREATE POLICY "service only" ON %I FOR ALL USING (false)', tbl);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', tbl);
  END LOOP;
END $$;

-- Private Supabase Storage bucket for Co-Bid photos and compliance PDFs
-- Served via /api/cobid/files with auth & ring-fencing enforcement.
INSERT INTO storage.buckets (id, name, public)
VALUES ('cobid-files', 'cobid-files', false)
ON CONFLICT (id) DO NOTHING;
