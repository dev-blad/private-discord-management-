-- Raids are fought as their final boss (Olm, Verzik, the Wardens) but drop kills of the raid itself.
ALTER TABLE boss_bosses ADD COLUMN IF NOT EXISTS fight_name TEXT;
