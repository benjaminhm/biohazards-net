-- Source hash tracking for generated quote line-item runs.
-- Run after migration 028.

ALTER TABLE quote_line_item_runs
  ADD COLUMN IF NOT EXISTS source_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_schema_version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS generated_by_user_id TEXT;

CREATE INDEX IF NOT EXISTS quote_line_item_runs_source_hash_idx
  ON quote_line_item_runs(source_hash);
