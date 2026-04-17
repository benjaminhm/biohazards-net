-- supabase-migration-035-company-chemicals-catalogue.sql
--
-- Adds an org-level Chemicals catalogue stored as a JSONB blob on
-- company_profile. Shape is defined by ChemicalCatalogueItem[] in
-- src/lib/types.ts. Each row may carry a parsed SDS (sds_parsed) plus
-- the Supabase storage path to the original SDS PDF (sds_path inside
-- the `company-assets` bucket).
--
-- Like equipment_catalogue (migration 034), this is deliberately a JSONB
-- column rather than a separate table: catalogues are small, read-mostly,
-- edited together, and change infrequently. Moving to a table is easy
-- if usage patterns ever demand it.

ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS chemicals_catalogue JSONB DEFAULT NULL;

COMMENT ON COLUMN company_profile.chemicals_catalogue IS
  'Org-level chemicals catalogue. JSONB array of ChemicalCatalogueItem (see src/lib/types.ts).';
