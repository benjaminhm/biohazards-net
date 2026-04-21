-- Migration 039: Brain Dump — per-admin-user capture surface
-- A living list built from freeform staff brain-dumps. Raw text goes into
-- `brain_dump_captures`, Claude splits it into discrete rows in
-- `brain_dump_items`. HITL edit + soft-delete from the UI. Reminders are
-- modelled here (kind + due_at) but NOT yet wired to any scheduler.
--
-- Scope: per-admin-user within an org. Each admin has their own private
-- list — owner_user_id = clerk user id of the creator. org_id is still
-- enforced (cross-org isolation) but two admins in the same org never see
-- each other's items.
--
-- RLS: service-only, same pattern as progress_notes — all access via API
-- routes using createServiceClient() after auth + admin role check, with
-- every query filtered by both org_id AND owner_user_id.

DO $$ BEGIN
  CREATE TYPE brain_dump_kind AS ENUM ('todo', 'reminder', 'note', 'moment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE brain_dump_status AS ENUM ('open', 'done', 'snoozed', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per raw dump, preserved even after its derived items are edited
-- or deleted. Useful for audit + re-parsing if the prompt changes later.
CREATE TABLE IF NOT EXISTS brain_dump_captures (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  owner_user_id           TEXT NOT NULL,
  raw_text                TEXT NOT NULL,
  item_count              INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id      TEXT NOT NULL,
  created_by_first_name   TEXT NOT NULL DEFAULT '',
  CONSTRAINT brain_dump_captures_text_len CHECK (char_length(raw_text) <= 48000)
);

CREATE INDEX IF NOT EXISTS brain_dump_captures_owner_idx
  ON brain_dump_captures(org_id, owner_user_id, created_at DESC);

-- Structured items derived from a capture (or created manually). Soft-delete
-- only — HITL removal sets deleted_at so we can trace what was dropped.
CREATE TABLE IF NOT EXISTS brain_dump_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  owner_user_id           TEXT NOT NULL,
  capture_id              UUID REFERENCES brain_dump_captures(id) ON DELETE SET NULL,

  kind                    brain_dump_kind NOT NULL DEFAULT 'note',
  status                  brain_dump_status NOT NULL DEFAULT 'open',
  text                    TEXT NOT NULL,

  due_at                  TIMESTAMPTZ,
  priority                SMALLINT NOT NULL DEFAULT 0,
  tags                    TEXT[] NOT NULL DEFAULT '{}',

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id      TEXT NOT NULL,
  created_by_first_name   TEXT NOT NULL DEFAULT '',
  updated_by_user_id      TEXT NOT NULL,

  deleted_at              TIMESTAMPTZ,
  deleted_by_user_id      TEXT,

  CONSTRAINT brain_dump_items_text_len    CHECK (char_length(text) <= 4000),
  CONSTRAINT brain_dump_items_priority_ok CHECK (priority BETWEEN 0 AND 2)
);

CREATE INDEX IF NOT EXISTS brain_dump_items_owner_idx
  ON brain_dump_items(org_id, owner_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS brain_dump_items_due_idx
  ON brain_dump_items(org_id, owner_user_id, due_at)
  WHERE status = 'open' AND deleted_at IS NULL;

ALTER TABLE brain_dump_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_dump_items    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON brain_dump_captures;
CREATE POLICY "service only" ON brain_dump_captures FOR ALL USING (false);

DROP POLICY IF EXISTS "service only" ON brain_dump_items;
CREATE POLICY "service only" ON brain_dump_items    FOR ALL USING (false);

COMMENT ON TABLE brain_dump_captures IS
  'Raw brain-dump text submitted by an org admin; retained for audit + re-parse. Scoped per-user via owner_user_id.';
COMMENT ON TABLE brain_dump_items IS
  'Structured items derived from a brain-dump (or manually added). Kind is the AI bucket (todo/reminder/note/moment); status + HITL soft-delete drive the living list UI at /brain-dump. Scoped per-user via owner_user_id — admins do not see each other''s items.';
COMMENT ON COLUMN brain_dump_items.capture_id IS
  'Nullable: NULL for manually-entered items, otherwise the capture that produced this item.';
COMMENT ON COLUMN brain_dump_items.owner_user_id IS
  'Clerk user id of the admin who owns this item. All list/edit/delete operations filter by (org_id, owner_user_id).';
