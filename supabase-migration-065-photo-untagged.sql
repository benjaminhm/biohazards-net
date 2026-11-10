-- Migration 065: 'untagged' photo category.
--
-- A neutral bucket for photos loaded in bulk (photo.biohazards.net/bulk) or
-- uploaded from a report's photo browser. Untagged photos are never pulled into
-- composed documents by category; a report includes them only when a person
-- picks them into a section. They are stored with capture_phase 'assessment',
-- because several outputs include every 'progress' photo regardless of category.

ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_category_check;
ALTER TABLE photos ADD CONSTRAINT photos_category_check
  CHECK (category IN ('before', 'during', 'after', 'assessment', 'untagged'));
