-- Add white-label domain columns to company_profile
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS subdomain TEXT DEFAULT NULL;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS custom_domain TEXT DEFAULT NULL;

-- Index for fast tenant lookups on every request
CREATE INDEX IF NOT EXISTS idx_company_profile_subdomain ON company_profile(subdomain);
CREATE INDEX IF NOT EXISTS idx_company_profile_custom_domain ON company_profile(custom_domain);
