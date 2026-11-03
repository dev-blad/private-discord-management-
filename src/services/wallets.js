const { query, withTx } = require("../db");
const { UserError, fmt } = require("../utils/money");

/**
 * Apply one money movement inside an existing transaction.
 * Locks the wallet row, refuses to go negative, updates the cached total and
 * appends an immutable ledger row. This is the ONLY place balances change.
 */
async function applyLedger(client, { discordId, bucket, delta, kind, jobId = null, payoutId = null, actorId = null, note = null }) {
    if (!Number.isInteger(delta) || delta === 0) throw new Error("delta must be a non-zero integer (cents)");
    const col = bucket === "balance" ? "balance_cents" : bucket === "earnings" ? "earnings_cents" : null;
    if (!col) throw new Error(`unknown bucket ${bucket}`);

    await client.query("INSERT INTO wallets (discord_id) VALUES ($1) ON CONFLICT DO NOTHING", [discordId]);
    const { rows } = await client.query("SELECT * FROM wallets WHERE discord_id = $1 FOR UPDATE", [discordId]);
    const w = rows[0];

    const next = w[col] + delta;
    if (next < 0) {
        throw new UserError(`Insufficient ${bucket === "balance" ? "balance" : "earnings"}: has ${fmt(w[col])}, needs ${fmt(-delta)}.`);
    }

    let spent = w.spent_cents;
    if (kind === "job_charge") spent += -delta;
    if (kind === "job_refund") spent = Math.max(0, spent - delta);

    await client.query(
        `UPDATE wallets SET ${col} = $2, spent_cents = $3 WHERE discord_id = $1`,
        [discordId, next, spent]
    );
    await client.query(
        `INSERT INTO ledger (discord_id, bucket, delta_cents, balance_after_cents, kind, job_id, payout_id, actor_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [discordId, bucket, delta, next, kind, jobId, payoutId, actorId, note]
    );
    return { balance: bucket === "balance" ? next : w.balance_cents, earnings: bucket === "earnings" ? next : w.earnings_cents, spent };
}

async function getWallet(discordId) {
    const { rows } = await query("SELECT * FROM wallets WHERE discord_id = $1", [discordId]);
    const w = rows[0];
    return {
        balance: w ? w.balance_cents : 0,
        earnings: w ? w.earnings_cents : 0,
        spent: w ? w.spent_cents : 0
    };
}

async function deposit({ discordId, cents, actorId, note, kind = "deposit" }) {
    if (cents <= 0) throw new UserError("Amount must be greater than zero.");
    return withTx(async c => {
        const r = await applyLedger(c, { discordId, bucket: "balance", delta: cents, kind, actorId, note });
        await c.query("INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,'wallet.add','wallet',$2,$3)",
            [actorId, discordId, { cents, note }]);
        return r;
    });
}

async function charge({ discordId, cents, actorId, note }) {
    if (cents <= 0) throw new UserError("Amount must be greater than zero.");
    return withTx(async c => {
        const r = await applyLedger(c, { discordId, bucket: "balance", delta: -cents, kind: "withdraw", actorId, note });
        await c.query("INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,'wallet.remove','wallet',$2,$3)",
            [actorId, discordId, { cents, note }]);
        return r;
    });
}

async function history(discordId, limit = 10) {
    const { rows } = await query(
        "SELECT * FROM ledger WHERE discord_id = $1 ORDER BY id DESC LIMIT $2", [discordId, limit]);
    return rows;
}

async function getProfile(discordId) {
    const { rows } = await query("SELECT * FROM profiles WHERE discord_id = $1", [discordId]);
    return rows[0] || null;
}

async function setPayoutAddress(discordId, method, address) {
    await query(
        `INSERT INTO profiles (discord_id, payout_method, payout_address) VALUES ($1,$2,$3)
         ON CONFLICT (discord_id) DO UPDATE SET payout_method = EXCLUDED.payout_method,
            payout_address = EXCLUDED.payout_address, updated_at = now()`,
        [discordId, method, address]
    );
}

module.exports = { applyLedger, getWallet, deposit, charge, history, getProfile, setPayoutAddress };
