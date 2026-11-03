/**
 * One-off: load existing customer balances (and optionally worker earnings) into the ledger.
 *
 *   node scripts/import-wallets.js wallets.csv            # dry run
 *   node scripts/import-wallets.js wallets.csv --commit   # write it
 *
 * CSV header: discord_id,balance_usd[,earnings_usd][,spent_usd]
 * Each row becomes ledger entries of kind 'migration', so the import is fully auditable.
 * Safe to re-run: a user who already has a 'migration' entry is skipped.
 */
require("dotenv").config();
const fs = require("fs");
const { withTx, close } = require("../src/db");
const { applyLedger } = require("../src/services/wallets");
const { toCents, fmt } = require("../src/utils/money");

async function main() {
    const [file, flag] = process.argv.slice(2);
    if (!file) { console.error("usage: import-wallets.js <file.csv> [--commit]"); process.exit(1); }
    const commit = flag === "--commit";

    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(l => l.trim());
    const head = lines.shift().split(",").map(h => h.trim().toLowerCase());
    const col = n => head.indexOf(n);
    if (col("discord_id") < 0 || col("balance_usd") < 0) throw new Error("CSV needs discord_id and balance_usd columns");

    await require("../src/db/migrate").migrate();
    let rows = 0, skipped = 0, total = 0;
    for (const line of lines) {
        const f = line.split(",").map(x => x.trim());
        const id = f[col("discord_id")];
        if (!/^\d{15,22}$/.test(id)) { console.warn(`skip bad id: ${id}`); skipped++; continue; }
        const bal = toCents(Number(f[col("balance_usd")] || 0));
        const earn = col("earnings_usd") >= 0 ? toCents(Number(f[col("earnings_usd")] || 0)) : 0;
        const spent = col("spent_usd") >= 0 ? toCents(Number(f[col("spent_usd")] || 0)) : 0;
        total += bal + earn;
        rows++;
        if (!commit) { console.log(`[dry] ${id} balance ${fmt(bal)} earnings ${fmt(earn)} spent ${fmt(spent)}`); continue; }

        await withTx(async c => {
            const done = await c.query("SELECT 1 FROM ledger WHERE discord_id=$1 AND kind='migration' LIMIT 1", [id]);
            if (done.rows.length) { skipped++; return; }
            if (bal > 0) await applyLedger(c, { discordId: id, bucket: "balance", delta: bal, kind: "migration", note: "Imported from old system" });
            if (earn > 0) await applyLedger(c, { discordId: id, bucket: "earnings", delta: earn, kind: "migration", note: "Imported from old system" });
            await c.query("INSERT INTO wallets (discord_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
            if (spent > 0) await c.query("UPDATE wallets SET spent_cents = spent_cents + $2 WHERE discord_id=$1", [id, spent]);
        });
    }
    console.log(`${commit ? "Imported" : "Would import"} ${rows} wallets (${fmt(total)} total), ${skipped} skipped.`);
    if (!commit) console.log("Dry run only. Add --commit to write.");
    await close();
}
main().catch(e => { console.error(e); process.exit(1); });
