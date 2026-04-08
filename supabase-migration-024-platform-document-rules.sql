-- Migration 024: Platform-wide AI document rules (editable by platform operators in /admin)
-- Run in Supabase SQL Editor
--
-- Same shape as company_profile.document_rules: { "general": "...", "report": "...", "report_pdf": "https://...", ... }
-- Merged in prompts after code baseline and before per-org rules.

CREATE TABLE IF NOT EXISTS platform_document_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_rules   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_document_rules (document_rules)
SELECT '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM platform_document_rules LIMIT 1);

ALTER TABLE platform_document_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON platform_document_rules;
CREATE POLICY "service only" ON platform_document_rules
  FOR ALL USING (false);

COMMENT ON TABLE platform_document_rules IS 'Platform-wide Claude document_rules JSON; API uses service role; org rules layer on top';
