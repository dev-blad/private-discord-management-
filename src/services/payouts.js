const { query, withTx } = require("../db");
const { UserError, fmt } = require("../utils/money");
const { applyLedger } = require("./wallets");
const { audit } = require("./audit");
const config = require("./config");

/** Worker requests a payout. Funds are held (deducted) immediately so they can't be claimed twice. */
async function requestPayout({ discordId, cents }) {
    const minUsd = Number(await config.get("min_payout_usd", "10"));
    return withTx(async c => {
        const p = (await c.query("SELECT * FROM profiles WHERE discord_id=$1", [discordId])).rows[0];
        if (!p || !p.payout_address) throw new UserError("Set your payout address first with `/payout address`.");

        const w = (await c.query("SELECT earnings_cents FROM wallets WHERE discord_id=$1", [discordId])).rows[0];
        const available = w ? w.earnings_cents : 0;
        const amount = cents == null ? available : cents;

        if (amount <= 0) throw new UserError("You have no earnings to claim.");
        if (amount < Math.round(minUsd * 100)) throw new UserError(`Minimum payout is ${fmt(Math.round(minUsd * 100))}.`);
        if (amount > available) throw new UserError(`You only have ${fmt(available)} in earnings.`);

        const open = await c.query("SELECT 1 FROM payouts WHERE discord_id=$1 AND status IN ('requested','approved','sending') LIMIT 1", [discordId]);
        if (open.rows.length) throw new UserError("You already have a payout in progress.");

        const ins = await c.query(
            `INSERT INTO payouts (discord_id, amount_cents, method, address) VALUES ($1,$2,$3,$4) RETURNING *`,
            [discordId, amount, p.payout_method, p.payout_address]);
        const payout = ins.rows[0];
        await applyLedger(c, {
            discordId, bucket: "earnings", delta: -amount, kind: "payout_hold",
            payoutId: payout.id, actorId: discordId, note: `Payout #${payout.id}`
        });
        await audit(c, discordId, "payout.request", "payout", payout.id, { amount });
        return payout;
    });
}

async function setMessage(payoutId, channelId, messageId) {
    await query("UPDATE payouts SET channel_id=$2, message_id=$3 WHERE id=$1", [payoutId, channelId, messageId]);
}

async function approve({ payoutId, actorId }) {
    return withTx(async c => {
        const { rows } = await c.query(
            `UPDATE payouts SET status='approved', decided_by=$2, decided_at=now()
             WHERE id=$1 AND status='requested' RETURNING *`, [payoutId, actorId]);
        if (!rows.length) throw new UserError(`Payout #${payoutId} is not awaiting approval.`);
        await audit(c, actorId, "payout.approve", "payout", payoutId);
        return rows[0];
    });
}

/** Reject: release the held funds back to the worker. */
async function reject({ payoutId, actorId, note }) {
    return withTx(async c => {
        const { rows } = await c.query("SELECT * FROM payouts WHERE id=$1 FOR UPDATE", [payoutId]);
        const p = rows[0];
        if (!p) throw new UserError(`Payout #${payoutId} doesn't exist.`);
        if (!["requested", "approved"].includes(p.status)) throw new UserError(`Payout #${payoutId} is already ${p.status}.`);
        await applyLedger(c, {
            discordId: p.discord_id, bucket: "earnings", delta: p.amount_cents, kind: "payout_release",
            payoutId, actorId, note: note || `Payout #${payoutId} rejected`
        });
        const upd = await c.query(
            `UPDATE payouts SET status='rejected', decided_by=$2, decided_at=now(), note=$3 WHERE id=$1 RETURNING *`,
            [payoutId, actorId, note || null]);
        await audit(c, actorId, "payout.reject", "payout", payoutId, { note });
        return upd.rows[0];
    });
}

/** Mark an approved payout as paid, recording the transaction reference. */
async function markPaid({ payoutId, actorId, ref }) {
    return withTx(async c => {
        const { rows } = await c.query(
            `UPDATE payouts SET status='paid', paid_ref=COALESCE($2, paid_ref), paid_at=now(), note=NULL
             WHERE id=$1 AND status IN ('approved','sending') RETURNING *`, [payoutId, ref || null]);
        if (!rows.length) throw new UserError(`Payout #${payoutId} must be approved before it can be marked paid.`);
        await audit(c, actorId, "payout.paid", "payout", payoutId, { ref });
        return rows[0];
    });
}

async function getPayout(id) {
    const { rows } = await query("SELECT * FROM payouts WHERE id=$1", [id]);
    return rows[0] || null;
}

async function listPending() {
    const { rows } = await query("SELECT * FROM payouts WHERE status IN ('requested','approved','sending') ORDER BY id");
    return rows;
}

module.exports = { requestPayout, setMessage, approve, reject, markPaid, getPayout, listPending };
