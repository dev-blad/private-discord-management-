-- Pricing catalogue copied from the Google Sheet by !syncdatabase.
-- The sheet stays the place you edit prices; the bot only reads this copy.

CREATE TABLE catalog_entries (
    id        BIGSERIAL PRIMARY KEY,
    tab       TEXT NOT NULL,
    kind      TEXT NOT NULL CHECK (kind IN ('block', 'quest', 'skill', 'menu')),
    name      TEXT NOT NULL,
    name_key  TEXT NOT NULL,
    position  INT  NOT NULL,
    data      JSONB NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX catalog_entries_tab_name ON catalog_entries (lower(tab), name_key);

CREATE TABLE catalog_aliases (
    tab_key   TEXT NOT NULL,
    alias_key TEXT NOT NULL,
    entry_id  BIGINT NOT NULL REFERENCES catalog_entries(id) ON DELETE CASCADE,
    PRIMARY KEY (tab_key, alias_key)
);

CREATE TABLE catalog_sync_log (
    id          BIGSERIAL PRIMARY KEY,
    started_at  TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id    TEXT,
    ok          BOOLEAN NOT NULL,
    summary     JSONB NOT NULL
);

-- Roles that count as "job roles" on a worker's !w (e.g. Caper, Zerker).
CREATE TABLE job_roles (
    role_id TEXT PRIMARY KEY,
    name    TEXT NOT NULL
);
