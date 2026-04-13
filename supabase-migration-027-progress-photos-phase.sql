-- Photo capture phase marker for workflow isolation (assessment vs progress)
-- Run after migration 026.

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS capture_phase TEXT NOT NULL DEFAULT 'assessment'
  CHECK (capture_phase IN ('assessment', 'progress'));

-- Backfill existing progress evidence rows (legacy rows have no phase marker)
UPDATE photos
SET capture_phase = 'progress'
WHERE capture_phase = 'assessment'
  AND category IN ('during', 'after');

CREATE INDEX IF NOT EXISTS photos_capture_phase_idx ON photos(capture_phase);
