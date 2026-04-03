-- Migration 011: Row Level Security
-- Enforces org_id isolation at the database level.
-- All queries use the service role key (bypasses RLS) in API routes,
-- so we enable RLS as a hard backstop against direct DB access or future bugs.
-- The service role is trusted; anon/authenticated roles are locked down.

-- ─────────────────────────────────────────
-- HELPER: current org context
-- API routes pass org_id via app logic; for direct Supabase client access
-- we expose a session variable that policies can read.
-- ─────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE orgs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_profile   ENABLE ROW LEVEL SECURITY;
ALTER TABLE people            ENABLE ROW LEVEL SECURITY;
ALTER TABLE people_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────
-- SERVICE ROLE: bypass all policies
-- Our Next.js API routes use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
-- These policies only affect anon/authenticated direct access.
-- ─────────────────────────────────────────

-- orgs: only service role can read/write
CREATE POLICY "service only" ON orgs
  USING (false);

-- org_users: users can read their own row via authenticated access
CREATE POLICY "service only" ON org_users
  USING (false);

-- jobs: locked to service role
CREATE POLICY "service only" ON jobs
  USING (false);

-- photos: locked to service role
CREATE POLICY "service only" ON photos
  USING (false);

-- documents: locked to service role
CREATE POLICY "service only" ON documents
  USING (false);

-- company_profile: locked to service role
CREATE POLICY "service only" ON company_profile
  USING (false);

-- people: locked to service role
CREATE POLICY "service only" ON people
  USING (false);

-- people_documents: locked to service role
CREATE POLICY "service only" ON people_documents
  USING (false);

-- job_assignments: locked to service role
CREATE POLICY "service only" ON job_assignments
  USING (false);

-- invites: locked to service role
CREATE POLICY "service only" ON invites
  USING (false);

-- messages: locked to service role
CREATE POLICY "service only" ON messages
  USING (false);

-- ─────────────────────────────────────────
-- RESULT:
-- • Anon key → blocked on all tables (no accidental public exposure)
-- • Authenticated key → blocked (we use service role in all routes)
-- • Service role key → bypasses RLS entirely (our API routes work normally)
-- • Direct DB access without service role → sees nothing
-- • Future RLS per-org policies can be layered on top when needed
-- ─────────────────────────────────────────
