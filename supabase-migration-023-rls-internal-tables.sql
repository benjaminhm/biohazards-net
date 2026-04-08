-- Migration 023: Row Level Security for internal / platform tables
-- Run in Supabase SQL Editor
--
-- These tables were created after migration 011 and had RLS disabled, which
-- triggers Supabase "RLS Disabled in Public" advisories.
-- API routes use SUPABASE_SERVICE_ROLE_KEY (bypasses RLS); anon/authenticated
-- direct access should see nothing — same pattern as migration 011.

ALTER TABLE impersonation_audit      ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_email_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_audit         ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_invite_send_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reviews         ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_invoices   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON impersonation_audit;
CREATE POLICY "service only" ON impersonation_audit
  FOR ALL USING (false);

DROP POLICY IF EXISTS "service only" ON job_email_messages;
CREATE POLICY "service only" ON job_email_messages
  FOR ALL USING (false);

DROP POLICY IF EXISTS "service only" ON membership_audit;
CREATE POLICY "service only" ON membership_audit
  FOR ALL USING (false);

DROP POLICY IF EXISTS "service only" ON platform_invite_send_log;
CREATE POLICY "service only" ON platform_invite_send_log
  FOR ALL USING (false);

DROP POLICY IF EXISTS "service only" ON platform_reviews;
CREATE POLICY "service only" ON platform_reviews
  FOR ALL USING (false);

DROP POLICY IF EXISTS "service only" ON subcontractor_invoices;
CREATE POLICY "service only" ON subcontractor_invoices
  FOR ALL USING (false);
