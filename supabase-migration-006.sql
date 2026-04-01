-- People profiles
CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT DEFAULT 'subcontractor',
  status TEXT DEFAULT 'active',
  notes TEXT,
  emergency_contact TEXT,
  emergency_phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- WHS / training documents per person
CREATE TABLE IF NOT EXISTS people_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID REFERENCES people(id) ON DELETE CASCADE,
  org_id UUID REFERENCES orgs(id),
  doc_type TEXT NOT NULL,
  label TEXT,
  expiry_date DATE,
  file_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Job assignments (link people to jobs)
CREATE TABLE IF NOT EXISTS job_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  person_id UUID REFERENCES people(id) ON DELETE CASCADE,
  org_id UUID REFERENCES orgs(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(job_id, person_id)
);
