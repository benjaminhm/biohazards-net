-- Migration 046: Assert RLS + service-only policies on all app tables
-- Run in Supabase SQL Editor (safe to re-run).
--
-- Context:
--   • API routes use SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
--   • Anon / authenticated Data API must see nothing — same pattern as
--     migrations 011, 023, and every recent CREATE TABLE.
--   • Column-only migrations (040–045, etc.) inherit table RLS; this file
--     re-asserts policies so nothing recent was left open by mistake.
--
-- FOR ALL USING (false) → WITH CHECK also uses false when omitted.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    -- Core (011)
    'orgs',
    'org_users',
    'jobs',
    'photos',
    'documents',
    'company_profile',
    'people',
    'people_documents',
    'job_assignments',
    'invites',
    'messages',
    -- Bundles / quotes / progress
    'document_bundles',
    'quote_line_item_runs',
    'quote_line_items',
    'progress_notes',
    'progress_room_notes',
    -- Platform / internal (023)
    'impersonation_audit',
    'job_email_messages',
    'membership_audit',
    'platform_invite_send_log',
    'platform_reviews',
    'subcontractor_invoices',
    'platform_document_rules',
    -- Recent feature tables (039–043)
    'brain_dump_captures',
    'brain_dump_items',
    'person_job_tasks',
    'person_job_notes',
    'job_prestart_briefings',
    'job_prestart_acknowledgements'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skip missing table: %', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- Policy names are identifiers, so %I ("service only"), not %L ('service only').
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'service only', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (false)',
      'service only',
      t
    );
  END LOOP;
END $$;

-- jobs.trading_name (045) is covered by jobs RLS above — no column-level RLS in Postgres.
COMMENT ON COLUMN jobs.trading_name IS
  'Operating trading name for this job''s client-facing documents. brisbane_biohazard_cleaning | forensic_cleaning_qld. NULL until selected. Covered by jobs RLS (service-only).';
