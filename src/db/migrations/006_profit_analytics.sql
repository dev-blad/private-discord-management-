-- Where a deposit came from (crypto / paypal / gp / other), for analytics and the payout-wallet maths.
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS source TEXT;

-- Profit the partners have taken out of the business.
CREATE TABLE IF NOT EXISTS partner_withdrawals (
    id          BIGSERIAL PRIMARY KEY,
    partner_id  TEXT NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    note        TEXT,
    actor_id    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
