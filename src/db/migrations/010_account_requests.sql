-- Customers hand their login details to the worker through the bot, so nobody else sees them.
CREATE TABLE IF NOT EXISTS account_requests (
    id            BIGSERIAL PRIMARY KEY,
    channel_id    TEXT NOT NULL,
    message_id    TEXT,
    requested_by  TEXT NOT NULL,
    customer_id   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted')),
    details_enc   TEXT,
    submitted_by  TEXT,
    submitted_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
