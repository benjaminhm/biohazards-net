-- Job pre-start briefings.
-- Job-level toolbox/pre-start videos visible to all assigned team members,
-- with per-person acknowledgement tracking.

CREATE TABLE IF NOT EXISTS job_prestart_briefings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  job_id             UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  video_url          TEXT NOT NULL,
  thumbnail_url      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id TEXT NOT NULL DEFAULT '',
  updated_by_user_id TEXT NOT NULL DEFAULT '',
  CONSTRAINT job_prestart_briefings_title_len CHECK (char_length(title) BETWEEN 1 AND 240),
  CONSTRAINT job_prestart_briefings_description_len CHECK (char_length(description) <= 50000),
  CONSTRAINT job_prestart_briefings_video_url_len CHECK (char_length(video_url) BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS job_prestart_briefings_job_idx
  ON job_prestart_briefings(org_id, job_id, created_at);

CREATE TABLE IF NOT EXISTS job_prestart_acknowledgements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  briefing_id     UUID NOT NULL REFERENCES job_prestart_briefings(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  person_id       UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  viewed_at       TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_prestart_ack_uniq UNIQUE (org_id, briefing_id, person_id)
);

CREATE INDEX IF NOT EXISTS job_prestart_ack_job_idx
  ON job_prestart_acknowledgements(org_id, job_id, person_id);

ALTER TABLE job_prestart_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_prestart_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON job_prestart_briefings;
CREATE POLICY "service only" ON job_prestart_briefings
  FOR ALL USING (false);

DROP POLICY IF EXISTS "service only" ON job_prestart_acknowledgements;
CREATE POLICY "service only" ON job_prestart_acknowledgements
  FOR ALL USING (false);
