const fs = require("fs");
const path = require("path");
const { getPool } = require("./index");

async function migrate() {
    const pool = getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

    const dir = path.join(__dirname, "migrations");
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
    const done = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map(r => r.name));

    for (const file of files) {
        if (done.has(file)) continue;
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(727201)");
            await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
            await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
            await client.query("COMMIT");
            console.log(`[db] applied migration ${file}`);
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw new Error(`Migration ${file} failed: ${err.message}`);
        } finally {
            client.release();
        }
    }
}

module.exports = { migrate };

if (require.main === module) {
    require("dotenv").config();
    migrate().then(() => require("./index").close()).catch(e => { console.error(e); process.exit(1); });
}
