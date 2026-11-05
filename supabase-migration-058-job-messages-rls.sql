-- job_messages was exposed to the public (anon) key with RLS off. Nothing in
-- the app reads it; with RLS on and no policies only the service role can.

ALTER TABLE job_messages ENABLE ROW LEVEL SECURITY;
