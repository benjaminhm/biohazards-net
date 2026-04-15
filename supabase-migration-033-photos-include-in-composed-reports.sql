-- Per-photo toggle: omit from printed / PDF composed documents (quote, SOW, report, iaq_multi).
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS include_in_composed_reports BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN photos.include_in_composed_reports IS 'When false, photo is omitted from composed HTML/PDF outputs.';
