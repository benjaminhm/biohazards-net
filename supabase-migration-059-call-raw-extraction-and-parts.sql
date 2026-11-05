-- inbound_calls: keep the head agent's untouched output next to the normalised
-- extraction, so a field lost in normalisation can be traced; and keep every
-- recording part (VoIPline emails long calls as several part00N.mp3 emails that
-- share one "Unique call ID").

ALTER TABLE inbound_calls
  ADD COLUMN IF NOT EXISTS extraction_raw JSONB,
  ADD COLUMN IF NOT EXISTS recording_parts JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Append recording parts without losing a part that arrived at the same moment.
-- Parts already present (same ref) are skipped. Returns the call's part count.
CREATE OR REPLACE FUNCTION append_call_recording_parts(p_call_id UUID, p_parts JSONB)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE inbound_calls c
  SET recording_parts = c.recording_parts || COALESCE((
        SELECT jsonb_agg(p)
        FROM jsonb_array_elements(p_parts) p
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(c.recording_parts) e WHERE e->>'ref' = p->>'ref'
        )
      ), '[]'::jsonb),
      updated_at = NOW()
  WHERE c.id = p_call_id
  RETURNING jsonb_array_length(c.recording_parts);
$$;

REVOKE EXECUTE ON FUNCTION append_call_recording_parts(UUID, JSONB) FROM PUBLIC, anon, authenticated;
