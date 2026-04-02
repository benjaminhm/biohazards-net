-- Migration 009: Capabilities-based permissions
-- Run in Supabase SQL Editor

-- 1. Add capabilities JSONB column to org_users
ALTER TABLE org_users ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Add person_id link so invite/profile can be tied together
ALTER TABLE org_users ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE invites   ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES people(id) ON DELETE SET NULL;

-- 3. Migrate existing roles → admin | member
UPDATE org_users SET role = 'admin'  WHERE role IN ('owner', 'admin');
UPDATE org_users SET role = 'member' WHERE role IN ('operator', 'field');
