-- A worker can save one address per coin/network and choose which to use when cashing out.
CREATE TABLE IF NOT EXISTS payout_addresses (
    discord_id TEXT NOT NULL,
    method     TEXT NOT NULL,
    address    TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (discord_id, method)
);
INSERT INTO payout_addresses (discord_id, method, address)
    SELECT discord_id, payout_method, payout_address FROM profiles
    WHERE payout_method IS NOT NULL AND payout_address IS NOT NULL
ON CONFLICT DO NOTHING;
