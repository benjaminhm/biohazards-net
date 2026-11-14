-- Subcontractor invoices outlive the person who sent them: the name is kept on
-- the invoice, and deleting the person clears the link instead of the invoice.

ALTER TABLE subcontractor_invoices ADD COLUMN IF NOT EXISTS person_name TEXT;

UPDATE subcontractor_invoices si
SET person_name = p.name
FROM people p
WHERE p.id = si.person_id AND si.person_name IS NULL;

ALTER TABLE subcontractor_invoices ALTER COLUMN person_id DROP NOT NULL;

ALTER TABLE subcontractor_invoices DROP CONSTRAINT IF EXISTS subcontractor_invoices_person_id_fkey;
ALTER TABLE subcontractor_invoices
  ADD CONSTRAINT subcontractor_invoices_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL;
