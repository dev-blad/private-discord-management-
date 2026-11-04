-- Account sales: listings the owners make and sell outside the wallet system.
CREATE TABLE IF NOT EXISTS account_prefixes (
    prefix     TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY,               -- e.g. T001, Tr001 (prefix shows who made it)
    prefix        TEXT NOT NULL,
    seq           INT  NOT NULL,
    creator_id    TEXT NOT NULL,
    account_type  TEXT NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    price_cents   BIGINT NOT NULL CHECK (price_cents > 0),
    stock         INT NOT NULL DEFAULT 1 CHECK (stock >= 0),
    image_url     TEXT,
    details_enc   TEXT,                            -- delivery details, AES-256-GCM encrypted
    channel_id    TEXT,
    message_id    TEXT,
    status        TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','deleted')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (prefix, seq)
);

CREATE TABLE IF NOT EXISTS account_sales (
    id          BIGSERIAL PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES accounts(id),
    buyer_id    TEXT NOT NULL,
    sold_cents  BIGINT NOT NULL CHECK (sold_cents >= 0),
    listed_cents BIGINT NOT NULL,
    sold_by     TEXT NOT NULL,
    sold_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    undone      BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS account_sales_sold_at ON account_sales (sold_at);
