-- GST toggle for quote line-item runs: when true, merged quote shows subtotal ex-GST +10% GST + total.

ALTER TABLE quote_line_item_runs
  ADD COLUMN IF NOT EXISTS add_gst_to_total BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN quote_line_item_runs.add_gst_to_total IS 'Line item totals are ex-GST; when true, document adds GST (10%) and total inc-GST.';
