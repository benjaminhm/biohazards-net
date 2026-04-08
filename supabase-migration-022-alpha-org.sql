-- Migration 022: Establish Alpha Org (biohazards-net)
-- Run in Supabase SQL Editor

-- Ensure the platform's Alpha Org exists as a first-class organisation.
INSERT INTO orgs (name, slug, plan, seat_limit, features, is_active)
VALUES ('biohazards.net', 'biohazards-net', 'business', 9999, '{"show_quick_feedback": false}'::jsonb, true)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  is_active = true,
  plan = EXCLUDED.plan;

-- Allow platform role invites if needed by provisioning flows.
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE invites
  ADD CONSTRAINT invites_role_check
  CHECK (role IN (
    'admin',
    'manager',
    'team_lead',
    'member',
    'operator',
    'field',
    'client',
    'property_manager',
    'body_corp',
    'platform_owner',
    'platform_admin'
  ));
