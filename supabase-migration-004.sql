-- Add document_rules JSONB column to company_profile
-- This stores the biohazards.md voice & rules for Claude document generation
-- Structure: { general: string, quote: string, sow: string, ... }
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS document_rules JSONB DEFAULT NULL;
