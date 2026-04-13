-- Migration 025: Allow documents.type = 'assessment_document'
--
-- Legacy supabase-schema.sql constrained documents.type to quote/sow/report.
-- Later migrations may have widened or dropped that CHECK. Drop the old
-- constraint if present so new DocTypes can be inserted without listing every slug.

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
