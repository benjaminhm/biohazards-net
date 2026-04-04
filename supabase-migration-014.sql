-- migration-014: platform_reviews
-- Reviews submitted by member organisations about the biohazards.net platform.
-- is_published controls whether they appear on the public website.

CREATE TABLE IF NOT EXISTS platform_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid REFERENCES orgs(id) ON DELETE CASCADE NOT NULL,
  rating         int NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body           text,
  reviewer_name  text,
  is_published   boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One review per org
CREATE UNIQUE INDEX IF NOT EXISTS platform_reviews_org_unique ON platform_reviews(org_id);

-- Fast lookup for published reviews
CREATE INDEX IF NOT EXISTS platform_reviews_published ON platform_reviews(is_published) WHERE is_published = true;
