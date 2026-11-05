-- Boss prizes can now be a % discount on the next order or a server role, as well as wallet credit or a manual item.
ALTER TABLE boss_prizes ADD COLUMN IF NOT EXISTS discount_pct INT NOT NULL DEFAULT 0;
ALTER TABLE boss_prizes ADD COLUMN IF NOT EXISTS role_name TEXT;
DO $$
DECLARE c TEXT;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'boss_prizes'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%kind%' LOOP
        EXECUTE format('ALTER TABLE boss_prizes DROP CONSTRAINT %I', c);
    END LOOP;
END $$;
ALTER TABLE boss_prizes ADD CONSTRAINT boss_prizes_kind_check CHECK (kind IN ('credit','item','discount','role'));

-- One pending "% off next order" per customer (they keep the better one if they win another).
CREATE TABLE IF NOT EXISTS customer_discounts (
    discord_id TEXT PRIMARY KEY,
    percent    INT NOT NULL CHECK (percent BETWEEN 1 AND 100),
    source     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS discount_pct INT NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS list_price_cents BIGINT;

-- Replace the starter prizes with the real loot tables.
UPDATE boss_prizes SET active = FALSE WHERE active;
INSERT INTO boss_prizes (rarity, name, kind, credit_cents, discount_pct, role_name, weight) VALUES
    ('common',   '10% off your next order', 'discount', 0,    10, NULL,          50),
    ('common',   '20 Bandos kills',         'item',     0,    0,  NULL,          30),
    ('common',   'Cabbage role',            'role',     0,    0,  'Cabbage',     15),
    ('common',   '$5 wallet credit',        'credit',   500,  0,  NULL,          5),
    ('uncommon', '15% off your next order', 'discount', 0,    15, NULL,          40),
    ('uncommon', '50 Zulrah kills',         'item',     0,    0,  NULL,          25),
    ('uncommon', '$10 wallet credit',       'credit',   1000, 0,  NULL,          25),
    ('uncommon', 'Free quest (up to $2)',   'item',     0,    0,  NULL,          10),
    ('rare',     '20% off your next order', 'discount', 0,    20, NULL,          40),
    ('rare',     '100 Vorkath kills',       'item',     0,    0,  NULL,          25),
    ('rare',     '$25 wallet credit',       'credit',   2500, 0,  NULL,          25),
    ('rare',     'High Roller channel access', 'role',  0,    0,  'High Roller', 10),
    ('ultra',    '25% off your next order', 'discount', 0,    25, NULL,          35),
    ('ultra',    '10 Nex kills',            'item',     0,    0,  NULL,          25),
    ('ultra',    '$50 wallet credit',       'credit',   5000, 0,  NULL,          25),
    ('ultra',    'Free service (up to $10)','item',     0,    0,  NULL,          15);
