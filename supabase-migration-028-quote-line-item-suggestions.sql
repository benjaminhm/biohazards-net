-- Quote line item suggestions (AI + manual), grouped by room with active run replacement.
-- Run after prior migrations.

CREATE TABLE IF NOT EXISTS quote_line_item_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  target_amount     NUMERIC(12,2),
  target_price_note TEXT NOT NULL DEFAULT '',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS quote_line_item_runs_active_job_idx
  ON quote_line_item_runs(job_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS quote_line_item_runs_org_idx
  ON quote_line_item_runs(org_id);

CREATE TABLE IF NOT EXISTS quote_line_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES quote_line_item_runs(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  room_name         TEXT NOT NULL,
  description       TEXT NOT NULL,
  qty               NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit              TEXT NOT NULL DEFAULT 'hrs',
  rate              NUMERIC(12,2) NOT NULL DEFAULT 0,
  total             NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order        INT NOT NULL DEFAULT 0,
  source            TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL,
  deleted_at        TIMESTAMPTZ,
  CONSTRAINT quote_line_items_qty_nonneg CHECK (qty >= 0),
  CONSTRAINT quote_line_items_rate_nonneg CHECK (rate >= 0)
);

CREATE INDEX IF NOT EXISTS quote_line_items_job_idx
  ON quote_line_items(job_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS quote_line_items_run_idx
  ON quote_line_items(run_id)
  WHERE deleted_at IS NULL;

ALTER TABLE quote_line_item_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON quote_line_item_runs;
CREATE POLICY "service only" ON quote_line_item_runs
  FOR ALL USING (false);

DROP POLICY IF EXISTS "service only" ON quote_line_items;
CREATE POLICY "service only" ON quote_line_items
  FOR ALL USING (false);
