-- migration-015: subcontractor_invoices
-- Invoices generated from a team member's profile for work completed on a job.
-- Tracks agreed amount, works undertaken, bank details, and send status.

CREATE TABLE IF NOT EXISTS subcontractor_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid REFERENCES orgs(id) ON DELETE CASCADE NOT NULL,
  person_id           uuid REFERENCES people(id) ON DELETE CASCADE NOT NULL,
  job_id              uuid REFERENCES jobs(id) ON DELETE SET NULL,
  invoice_number      text NOT NULL,
  works_undertaken    text,
  agreed_amount       numeric(10,2) NOT NULL,
  bank_account_name   text,
  bank_bsb            text,
  bank_account_number text,
  status              text NOT NULL DEFAULT 'draft',
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subcontractor_invoices_person ON subcontractor_invoices(person_id);
CREATE INDEX IF NOT EXISTS subcontractor_invoices_org    ON subcontractor_invoices(org_id);
