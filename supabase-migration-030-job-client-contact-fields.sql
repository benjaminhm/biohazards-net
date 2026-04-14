-- Migration 030: Client organisation, contact role, relationship to site, insurance claim ref
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_organization_name TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_contact_role TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_contact_relationship TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS insurance_claim_ref TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN jobs.client_organization_name IS 'Company or account name when the primary contact is a representative.';
COMMENT ON COLUMN jobs.client_contact_role IS 'Contact title/role (e.g. property manager).';
COMMENT ON COLUMN jobs.client_contact_relationship IS 'Relationship to site or incident (e.g. tenant, family member of occupant).';
COMMENT ON COLUMN jobs.insurance_claim_ref IS 'Insurer claim or reference number if applicable.';
