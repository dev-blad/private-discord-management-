const { query, withTx } = require("../db");
const { UserError, fmt } = require("../utils/money");

async function get(discordId, c = null) {
    const { rows } = await (c || { query }).query("SELECT amount_cents FROM worker_deposits WHERE discord_id=$1", [discordId]);
    return rows[0] ? Number(rows[0].amount_cents) : 0;
}

/** Change a worker's recorded deposit by delta cents (never below zero). */
async function adjust({ discordId, delta, actorId, note = null }) {
    return withTx(async c => {
        await c.query("INSERT INTO worker_deposits (discord_id) VALUES ($1) ON CONFLICT DO NOTHING", [discordId]);
        const cur = Number((await c.query("SELECT amount_cents FROM worker_deposits WHERE discord_id=$1 FOR UPDATE", [discordId])).rows[0].amount_cents);
        const next = cur + delta;
        if (next < 0) throw new UserError(`They only have ${fmt(cur)} on deposit.`);
        await c.query("UPDATE worker_deposits SET amount_cents=$2, updated_at=now() WHERE discord_id=$1", [discordId, next]);
        await c.query("INSERT INTO worker_deposit_log (discord_id, delta_cents, after_cents, actor_id, note) VALUES ($1,$2,$3,$4,$5)",
            [discordId, delta, next, actorId, note]);
        return next;
    });
}

const set = async ({ discordId, cents, actorId, note }) => adjust({ discordId, delta: cents - await get(discordId), actorId, note: note || "set" });

const list = async () => (await query("SELECT discord_id, amount_cents FROM worker_deposits WHERE amount_cents > 0 ORDER BY amount_cents DESC LIMIT 50")).rows;

module.exports = { get, adjust, set, list };
