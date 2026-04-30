-- Quote GST mode: no GST, GST-inclusive pricing, or GST added on top.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'quote_gst_mode'
  ) THEN
    CREATE TYPE quote_gst_mode AS ENUM ('no_gst', 'inclusive', 'exclusive');
  END IF;
END $$;

ALTER TABLE quote_line_item_runs
  ADD COLUMN IF NOT EXISTS gst_mode quote_gst_mode NOT NULL DEFAULT 'no_gst';

UPDATE quote_line_item_runs
SET gst_mode = CASE
  WHEN add_gst_to_total IS TRUE THEN 'exclusive'::quote_gst_mode
  ELSE 'no_gst'::quote_gst_mode
END
WHERE gst_mode = 'no_gst'::quote_gst_mode
  AND add_gst_to_total IS TRUE;

COMMENT ON COLUMN quote_line_item_runs.gst_mode IS 'Controls quote GST treatment: no_gst, inclusive, or exclusive/add GST on top.';
