const { query } = require("../db");

async function getAll() {
    const { rows } = await query("SELECT key, value FROM config ORDER BY key");
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function get(key, fallback = null) {
    const { rows } = await query("SELECT value FROM config WHERE key = $1", [key]);
    return rows.length ? rows[0].value : fallback;
}

async function set(key, value) {
    await query(
        `INSERT INTO config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, value]
    );
}

const del = key => query("DELETE FROM config WHERE key = $1", [key]);

module.exports = { getAll, get, set, del };
