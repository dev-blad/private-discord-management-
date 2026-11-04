-- Automatic payouts add a 'sending' state (signed/broadcast, awaiting confirmation).
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
    CHECK (status IN ('requested','approved','sending','paid','rejected'));
