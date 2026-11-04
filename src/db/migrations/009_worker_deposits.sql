-- Security deposit each worker has paid. Tracked here; the money itself sits in the manual deposit wallet.
CREATE TABLE IF NOT EXISTS worker_deposits (
    discord_id   TEXT PRIMARY KEY,
    amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS worker_deposit_log (
    id          BIGSERIAL PRIMARY KEY,
    discord_id  TEXT NOT NULL,
    delta_cents BIGINT NOT NULL,
    after_cents BIGINT NOT NULL,
    actor_id    TEXT,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
