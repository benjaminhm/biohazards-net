-- Audit log for platform admin invite emails/SMS (POST /api/admin/provision/send)

CREATE TABLE IF NOT EXISTS platform_invite_send_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid REFERENCES orgs(id) ON DELETE SET NULL,
  person_id       uuid REFERENCES people(id) ON DELETE SET NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient       text NOT NULL,
  org_name        text NOT NULL,
  admin_name      text NOT NULL,
  invite_url      text NOT NULL,
  provider_id     text,
  actor_clerk_id  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_invite_send_log_org_idx
  ON platform_invite_send_log(org_id, created_at DESC);
