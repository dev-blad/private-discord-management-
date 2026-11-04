-- In-game meeting spots a worker has saved for their accounts (RSN, world, location, screenshot).
CREATE TABLE IF NOT EXISTS worker_locations (
    id           BIGSERIAL PRIMARY KEY,
    discord_id   TEXT NOT NULL,
    rsn          TEXT NOT NULL,
    world        TEXT NOT NULL,
    location     TEXT NOT NULL,
    image        BYTEA,
    image_type   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS worker_locations_owner_rsn ON worker_locations (discord_id, lower(rsn));
