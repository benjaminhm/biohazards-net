-- ============================================
-- DROP — reverse of supabase-schema.sql only
-- ============================================
-- Use when you need a clean slate before re-running supabase-schema.sql
-- (e.g. wrong order, partial failure, empty dev DB experiments).
--
-- What this removes:
--   • Storage policies on storage.objects (from schema file)
--   • Tables: documents, photos, jobs (in safe FK order)
--
-- Buckets (job-photos, job-pdfs): Supabase blocks DELETE on storage.buckets from SQL.
-- To remove buckets: Dashboard → Storage → open each bucket → delete all files →
-- delete the bucket (or leave them; re-running supabase-schema.sql uses ON CONFLICT DO NOTHING).
--
-- If you already ran later migrations, other tables may still reference jobs.
-- This script uses CASCADE on jobs so the drop succeeds; foreign key constraints
-- from other tables to jobs are removed (those tables are NOT deleted — only jobs
-- and tables that depend on jobs in a way Postgres must cascade may be affected).
-- For a full dev wipe, consider dropping the whole public schema or use a new project.
-- ============================================

-- 1) Storage: policies created in supabase-schema.sql
DROP POLICY IF EXISTS "Allow all operations on job-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow all operations on job-pdfs" ON storage.objects;

-- 2) Buckets: do NOT delete via SQL (Supabase raises storage.protect_delete).
--    Use Dashboard → Storage, or leave buckets in place for dev.

-- 3) Tables: children before parent (photos & documents reference jobs)
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS photos CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
