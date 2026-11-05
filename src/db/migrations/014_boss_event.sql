-- Boss-kill event: spending earns tokens, a token is a boss kill, each boss drops prizes of its rarity.
CREATE TABLE IF NOT EXISTS boss_tokens (
    discord_id     TEXT PRIMARY KEY,
    tokens         INT    NOT NULL DEFAULT 0 CHECK (tokens >= 0),
    progress_cents BIGINT NOT NULL DEFAULT 0,
    earned_total   INT    NOT NULL DEFAULT 0,
    kills          INT    NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS boss_prizes (
    id          SERIAL PRIMARY KEY,
    rarity      TEXT NOT NULL CHECK (rarity IN ('common','uncommon','rare','ultra')),
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('credit','item')),
    credit_cents INT NOT NULL DEFAULT 0,
    stock       INT,                       -- NULL = unlimited
    weight      INT NOT NULL DEFAULT 1 CHECK (weight > 0),
    active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS boss_drops (
    id           SERIAL PRIMARY KEY,
    discord_id   TEXT NOT NULL,
    prize_id     INT REFERENCES boss_prizes(id),
    rarity       TEXT NOT NULL,
    prize_name   TEXT NOT NULL,
    kind         TEXT NOT NULL,
    credit_cents INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    redeemed     BOOLEAN NOT NULL DEFAULT FALSE,
    redeemed_by  TEXT,
    redeemed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS boss_drops_user ON boss_drops (discord_id, id DESC);

-- Starter wallet-credit prizes. Review them with /bossevent prizes and change to taste.
INSERT INTO boss_prizes (rarity, name, kind, credit_cents, weight)
SELECT * FROM (VALUES
    ('common',   '$0.25 wallet credit', 'credit', 25,   3),
    ('common',   '$0.50 wallet credit', 'credit', 50,   2),
    ('uncommon', '$1.00 wallet credit', 'credit', 100,  3),
    ('uncommon', '$1.50 wallet credit', 'credit', 150,  2),
    ('rare',     '$3.00 wallet credit', 'credit', 300,  3),
    ('rare',     '$5.00 wallet credit', 'credit', 500,  2),
    ('ultra',    '$10.00 wallet credit','credit', 1000, 3),
    ('ultra',    '$25.00 wallet credit','credit', 2500, 1)
) AS v(rarity, name, kind, credit_cents, weight)
WHERE NOT EXISTS (SELECT 1 FROM boss_prizes);
