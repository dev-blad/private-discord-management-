-- Customers can hold several boss discounts at once. Each order uses the best one; the rest stay saved.
ALTER TABLE customer_discounts DROP CONSTRAINT IF EXISTS customer_discounts_pkey;
ALTER TABLE customer_discounts ADD COLUMN IF NOT EXISTS id BIGSERIAL;
ALTER TABLE customer_discounts ADD PRIMARY KEY (id);
CREATE INDEX IF NOT EXISTS customer_discounts_user ON customer_discounts (discord_id, percent DESC);
