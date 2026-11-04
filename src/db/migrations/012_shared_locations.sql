-- Locations belong to the mule accounts, not to individual workers: one entry per RSN.
DELETE FROM worker_locations a USING worker_locations b
 WHERE lower(a.rsn) = lower(b.rsn) AND a.updated_at < b.updated_at;
DROP INDEX IF EXISTS worker_locations_owner_rsn;
CREATE UNIQUE INDEX IF NOT EXISTS worker_locations_rsn ON worker_locations (lower(rsn));
