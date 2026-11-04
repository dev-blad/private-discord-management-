-- Support staff earn a cut of the jobs they set up, by support role (set with /supportrole).
CREATE TABLE IF NOT EXISTS support_roles (
    role_id  TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    cut_pct  NUMERIC(5,2) NOT NULL CHECK (cut_pct >= 0 AND cut_pct <= 50)
);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS support_pct   NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS support_cents BIGINT;
