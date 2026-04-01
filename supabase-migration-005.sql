-- Add subdomain + custom_domain to company_profile
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS subdomain TEXT UNIQUE DEFAULT NULL;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS custom_domain TEXT UNIQUE DEFAULT NULL;

-- Set Brisbane Biohazard Cleaning as the brisbanebiohazardcleaning subdomain
UPDATE company_profile SET subdomain = 'brisbanebiohazardcleaning' WHERE subdomain IS NULL LIMIT 1;
