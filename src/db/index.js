const { Pool, types } = require("pg");

// BIGINT (cents) comes back as a string by default. Cents stay far below 2^53.
types.setTypeParser(20, v => Number(v));

let pool;

function getPool() {
    if (!pool) {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL is not set");
        const local = /localhost|127\.0\.0\.1|::1/i.test(url);
        pool = new Pool({
            connectionString: url,
            ssl: local || process.env.PGSSL === "off" ? false : { rejectUnauthorized: false },
            max: 10
        });
        pool.on("error", err => console.error("[db] pool error:", err));
    }
    return pool;
}

const query = (text, params) => getPool().query(text, params);

/** Run fn(client) inside a transaction. Rolls back on any error. */
async function withTx(fn) {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function close() {
    if (pool) await pool.end();
    pool = null;
}

module.exports = { query, withTx, getPool, close };
