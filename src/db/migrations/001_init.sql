-- All money is stored as integer USD cents. Never floats.

CREATE TABLE IF NOT EXISTS config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per Discord user.
--   balance_cents  = prepaid funds a customer can spend on jobs
--   earnings_cents = money a worker has earned and can claim as a payout
CREATE TABLE IF NOT EXISTS wallets (
    discord_id      TEXT PRIMARY KEY,
    balance_cents   BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents  >= 0),
    earnings_cents  BIGINT NOT NULL DEFAULT 0 CHECK (earnings_cents >= 0),
    spent_cents     BIGINT NOT NULL DEFAULT 0 CHECK (spent_cents    >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
    discord_id     TEXT PRIMARY KEY,
    payout_method  TEXT,
    payout_address TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
    id              BIGSERIAL PRIMARY KEY,
    customer_id     TEXT NOT NULL,
    worker_id       TEXT,
    price_cents     BIGINT NOT NULL CHECK (price_cents > 0),
    deposit_cents   BIGINT NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
    worker_pct      INTEGER NOT NULL CHECK (worker_pct BETWEEN 0 AND 100),
    worker_cents    BIGINT,
    house_cents     BIGINT,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','claimed','completed','cancelled')),
    description     TEXT NOT NULL,
    image_url       TEXT,
    channel_id      TEXT,
    board_channel_id TEXT,
    board_message_id TEXT,
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS jobs_status_idx   ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_worker_idx   ON jobs (worker_id);
CREATE INDEX IF NOT EXISTS jobs_customer_idx ON jobs (customer_id);

CREATE TABLE IF NOT EXISTS payouts (
    id           BIGSERIAL PRIMARY KEY,
    discord_id   TEXT NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    method       TEXT NOT NULL,
    address      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'requested'
                 CHECK (status IN ('requested','approved','paid','rejected')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by   TEXT,
    decided_at   TIMESTAMPTZ,
    paid_ref     TEXT,
    paid_at      TIMESTAMPTZ,
    note         TEXT,
    channel_id   TEXT,
    message_id   TEXT
);
CREATE INDEX IF NOT EXISTS payouts_status_idx ON payouts (status);
CREATE INDEX IF NOT EXISTS payouts_user_idx   ON payouts (discord_id);

-- Append-only record of every money movement. Rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS ledger (
    id                 BIGSERIAL PRIMARY KEY,
    discord_id         TEXT NOT NULL,
    bucket             TEXT NOT NULL CHECK (bucket IN ('balance','earnings')),
    delta_cents        BIGINT NOT NULL CHECK (delta_cents <> 0),
    balance_after_cents BIGINT NOT NULL,
    kind               TEXT NOT NULL,
    job_id             BIGINT REFERENCES jobs(id),
    payout_id          BIGINT REFERENCES payouts(id),
    actor_id           TEXT,
    note               TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger (discord_id, id DESC);
CREATE INDEX IF NOT EXISTS ledger_job_idx  ON ledger (job_id);

CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ledger is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_no_update ON ledger;
CREATE TRIGGER ledger_no_update BEFORE UPDATE OR DELETE ON ledger
    FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

CREATE TABLE IF NOT EXISTS audit_log (
    id         BIGSERIAL PRIMARY KEY,
    actor_id   TEXT,
    action     TEXT NOT NULL,
    entity     TEXT,
    entity_id  TEXT,
    data       JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricing (
    name        TEXT PRIMARY KEY,
    price_cents BIGINT NOT NULL CHECK (price_cents >= 0)
);

INSERT INTO config (key, value) VALUES
    ('worker_pct', '80'),
    ('min_payout_usd', '10')
ON CONFLICT (key) DO NOTHING;
