-- Every PvM boss from the pricing sheet is its own boss. Rows are synced from the catalog (services/bossroster.js);
-- the *_custom columns are staff overrides that a re-sync never touches.
CREATE TABLE IF NOT EXISTS boss_bosses (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    tier        TEXT NOT NULL CHECK (tier IN ('common','uncommon','rare','ultra')),
    kc          INT  NOT NULL DEFAULT 10 CHECK (kc >= 0),
    price_cents INT  NOT NULL DEFAULT 0,
    img         TEXT,
    tier_custom TEXT CHECK (tier_custom IN ('common','uncommon','rare','ultra')),
    kc_custom   INT,
    img_custom  TEXT,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    in_sheet    BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE boss_drops ADD COLUMN IF NOT EXISTS boss_name TEXT;

-- Boss kill-count drops are now generated per boss, so retire the fixed KC prizes.
UPDATE boss_prizes SET active = FALSE WHERE kind = 'item' AND name ILIKE '%kill%';

-- Generic tier prizes: roughly 30% off : 15% credit : 15% role/other (the other 40% is the boss's own kills).
UPDATE boss_prizes SET weight = 30 WHERE active AND kind = 'discount';
UPDATE boss_prizes SET weight = 15 WHERE active AND kind IN ('credit','role','item');
