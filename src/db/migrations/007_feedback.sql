CREATE TABLE IF NOT EXISTS job_feedback (
    job_id      BIGINT PRIMARY KEY REFERENCES jobs(id),
    customer_id TEXT NOT NULL,
    rating      TEXT NOT NULL CHECK (rating IN ('positive','negative')),
    anonymous   BOOLEAN NOT NULL DEFAULT false,
    review      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
