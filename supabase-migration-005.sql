-- Add subdomain + custom_domain to company_profile
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS subdomain TEXT UNIQUE DEFAULT NULL;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS custom_domain TEXT UNIQUE DEFAULT NULL;

-- Set Brisbane Biohazard Cleaning as the brisbanebiohazardcleaning subdomain
-- (PostgreSQL has no UPDATE ... LIMIT; pick one row if several have NULL subdomain.)
UPDATE company_profile
SET subdomain = 'brisbanebiohazardcleaning'
WHERE id = (SELECT id FROM company_profile WHERE subdomain IS NULL LIMIT 1);

-- ─── Multi-tenant platform foundation ────────────────────────────────────────

-- Orgs table
CREATE TABLE IF NOT EXISTS orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  custom_domain TEXT,
  plan TEXT DEFAULT 'solo',
  seat_limit INT DEFAULT 1,
  features JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Org users (membership)
CREATE TABLE IF NOT EXISTS org_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  role TEXT DEFAULT 'owner',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, clerk_user_id)
);

-- Add org_id to existing tables
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);
ALTER TABLE photos ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);

-- Seed BBC org
INSERT INTO orgs (name, slug, plan, seat_limit, features)
VALUES ('Brisbane Biohazard Cleaning', 'brisbanebiohazardcleaning', 'business', 10, '{"can_add_users": true, "can_franchise": false}')
ON CONFLICT (slug) DO NOTHING;

-- Migrate all existing data to BBC org
UPDATE jobs SET org_id = (SELECT id FROM orgs WHERE slug = 'brisbanebiohazardcleaning') WHERE org_id IS NULL;
UPDATE photos SET org_id = (SELECT id FROM orgs WHERE slug = 'brisbanebiohazardcleaning') WHERE org_id IS NULL;
UPDATE documents SET org_id = (SELECT id FROM orgs WHERE slug = 'brisbanebiohazardcleaning') WHERE org_id IS NULL;
UPDATE company_profile SET org_id = (SELECT id FROM orgs WHERE slug = 'brisbanebiohazardcleaning') WHERE org_id IS NULL;
