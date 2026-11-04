const { query } = require("../db");
const config = require("./config");
const { UserError } = require("../utils/money");

/**
 * Split the house's take. A fixed share of each job's price (buffer_pct) stays in the
 * payout wallet as a cushion; the rest is shared equally between the partners.
 * Pure, so it can be tested.
 */
function splitHouse({ houseCents, revenueCents, bufferPct, partnerCount }) {
    const buffer = Math.min(houseCents, Math.floor(revenueCents * bufferPct / 100));
    const pool = houseCents - buffer;
    const each = partnerCount > 0 ? Math.floor(pool / partnerCount) : 0;
    return { buffer, pool, each, remainder: pool - each * partnerCount };
}

async function partners() {
    return (await config.get("partner_ids", "")).split(",").map(x => x.trim()).filter(Boolean);
}

async function summary() {
    const ids = await partners();
    const bufferPct = Number(await config.get("house_buffer_pct", "1"));
    const j = (await query(`SELECT COALESCE(sum(price_cents),0) AS revenue, COALESCE(sum(house_cents),0) AS house
                            FROM jobs WHERE status='completed'`)).rows[0];
    const split = splitHouse({ houseCents: Number(j.house), revenueCents: Number(j.revenue), bufferPct, partnerCount: ids.length });
    const w = (await query("SELECT partner_id, COALESCE(sum(amount_cents),0) AS taken FROM partner_withdrawals GROUP BY 1")).rows;
    const taken = Object.fromEntries(w.map(r => [r.partner_id, Number(r.taken)]));
    return {
        bufferPct, ...split,
        houseCents: Number(j.house), revenueCents: Number(j.revenue),
        partners: ids.map(id => ({ id, accrued: split.each, taken: taken[id] || 0, available: split.each - (taken[id] || 0) })),
        takenTotal: w.reduce((n, r) => n + Number(r.taken), 0)
    };
}

async function withdraw({ partnerId, cents, actorId, note }) {
    if (cents <= 0) throw new UserError("Amount must be greater than zero.");
    const s = await summary();
    const p = s.partners.find(x => x.id === partnerId);
    if (!p) throw new UserError("That person isn't set as a partner. Use `/profit partners`.");
    if (cents > p.available) throw new UserError(`Only ${(p.available / 100).toFixed(2)} USD of profit is available for them.`);
    await query("INSERT INTO partner_withdrawals (partner_id, amount_cents, note, actor_id) VALUES ($1,$2,$3,$4)", [partnerId, cents, note || null, actorId]);
}

/** Everything the payout wallet has to cover, in cents. */
async function obligations() {
    const o = (await query(`
        SELECT (SELECT COALESCE(sum(earnings_cents),0) FROM wallets) AS earnings,
               (SELECT COALESCE(sum(balance_cents),0)  FROM wallets) AS customers,
               (SELECT COALESCE(sum(amount_cents),0) FROM payouts WHERE status IN ('requested','approved','sending')) AS pending`)).rows[0];
    const s = await summary();
    return { earnings: Number(o.earnings), customers: Number(o.customers), pending: Number(o.pending), buffer: s.buffer };
}

module.exports = { splitHouse, partners, summary, withdraw, obligations };
