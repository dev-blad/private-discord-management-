const { query } = require("../db");
const { UserError, fmt } = require("../utils/money");
const config = require("./config");
const chain = require("./chain");
const { audit } = require("./audit");
const { payoutEmbed, payoutRow } = require("../utils/embeds");

const num = async (key, dflt) => Number(await config.get(key, String(dflt)));

async function settings() {
    return {
        enabled: (await config.get("auto_payout_enabled", "false")) === "true",
        maxCents: Math.round((await num("auto_payout_max_usd", 100)) * 100),
        workerDayCents: Math.round((await num("auto_payout_daily_worker_usd", 250)) * 100),
        totalDayCents: Math.round((await num("auto_payout_daily_total_usd", 1000)) * 100),
        lowCents: Math.round((await num("pot_low_usd", 100)) * 100)
    };
}

/** Money sent (or in flight) in the last 24h, for the daily caps. */
async function sentLastDay(discordId) {
    const { rows } = await query(
        `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE discord_id=$1),0)::bigint AS worker,
                COALESCE(SUM(amount_cents),0)::bigint AS total
         FROM payouts WHERE status IN ('sending','paid') AND requested_at > now() - interval '24 hours'`, [discordId]);
    return { worker: Number(rows[0].worker), total: Number(rows[0].total) };
}

/** Does this payout qualify to be sent without a human? */
async function autoDecision(p) {
    const s = await settings();
    if (!s.enabled) return { ok: false, reason: "Automatic payouts are off" };
    if (!chain.configured()) return { ok: false, reason: "No payout key is configured" };
    if (!chain.supports(p.method)) return { ok: false, reason: `${p.method} payouts are sent manually` };
    if (p.amount_cents > s.maxCents) return { ok: false, reason: `Over the automatic limit of ${fmt(s.maxCents)}` };
    const day = await sentLastDay(p.discord_id);
    if (day.worker + p.amount_cents > s.workerDayCents) return { ok: false, reason: `Would pass this worker's daily cap of ${fmt(s.workerDayCents)}` };
    if (day.total + p.amount_cents > s.totalDayCents) return { ok: false, reason: `Would pass the daily total cap of ${fmt(s.totalDayCents)}` };
    return { ok: true };
}

const setState = async (id, status, note, hash) => (await query(
    `UPDATE payouts SET status=$2, note=$3, paid_ref=COALESCE($4, paid_ref) WHERE id=$1 RETURNING *`, [id, status, note, hash ?? null])).rows[0];

/**
 * Send a requested/approved payout on-chain.
 * Money is never lost or sent twice:
 *  - the row is claimed atomically ('sending') so two clicks can't both send;
 *  - the signed tx hash is saved BEFORE broadcast;
 *  - any failure before broadcast puts it back to 'approved' (funds stay held, staff can retry);
 *  - if the outcome is unknown after broadcast it stays 'sending' for a human to check.
 * Returns { state: 'paid'|'queued'|'manual'|'unconfirmed'|'rejected', payout, reason }.
 */
async function sendPayout({ payoutId, actorId }) {
    if (!chain.configured()) throw new UserError("No payout key is set on the bot, so this payout has to be sent by hand.");

    const claim = await query(
        `UPDATE payouts SET status='sending', decided_by=COALESCE(decided_by,$2), decided_at=COALESCE(decided_at, now())
         WHERE id=$1 AND status IN ('requested','approved') RETURNING *`, [payoutId, actorId]);
    if (!claim.rows.length) throw new UserError(`Payout #${payoutId} isn't waiting to be sent.`);
    const p = claim.rows[0];
    await audit({ query }, actorId, "payout.send_start", "payout", payoutId, { amount: p.amount_cents });

    if (!chain.supports(p.method))
        return { state: "manual", payout: await setState(p.id, "approved", `${p.method} is paid manually`), reason: `${p.method} payouts are sent by hand` };

    if (!chain.isValidAddress(p.address)) {
        await setState(p.id, "approved", "Invalid address");
        const fresh = await require("./payouts").reject({ payoutId: p.id, actorId: "system", note: "Invalid wallet address. Funds returned." });
        return { state: "rejected", payout: fresh, reason: "The saved address isn't a valid wallet address" };
    }

    return chain.serial(async () => {
        const back = async reason => ({ state: "queued", payout: await setState(p.id, "approved", reason), reason });
        const s = chain.sender(p.method);
        const a = chain.asset(p.method) || { symbol: "USDC", gas: "ETH" };

        let bal;
        try { bal = await s.balances(); } catch (e) { return back(`Couldn't reach the network: ${e.message}`.slice(0, 200)); }
        if (bal.tokenCents < p.amount_cents) return back(`Payout wallet too low (${fmt(bal.tokenCents)} ${a.symbol}). Top it up, then press Send.`);
        if (bal.gasWei <= 0n) return back(`Payout wallet has no ${a.gas} for fees on ${a.label}. Add a little, then press Send.`);

        let prepared;
        try {
            const maxGwei = a.defaultMaxGwei ? await num(`max_gas_gwei_${a.chainId}`, a.defaultMaxGwei) : 0;
            prepared = await s.prepare(p.address, chain.centsToUnits(p.amount_cents, a.decimals), { maxGwei });
        } catch (e) {
            return back(e instanceof chain.GasTooHigh ? `${e.message}. Press Send to retry when fees drop.` : `Couldn't sign the transfer: ${e.message}`.slice(0, 200));
        }

        await setState(p.id, "sending", null, prepared.hash);   // hash on record before it can move money
        try { await s.broadcast(prepared.raw); }
        catch (e) {
            const msg = String(e.message || e);
            if (!/already known|nonce too low|known transaction/i.test(msg)) {
                return { state: "unconfirmed", payout: await setState(p.id, "sending", `Broadcast error: ${msg}`.slice(0, 200)),
                    reason: "The send may or may not have reached the network. Check the hash before retrying." };
            }
        }

        let r;
        try { r = await s.confirm(prepared.hash, 90_000); } catch (e) { r = { confirmed: false }; }
        if (r.confirmed && r.success) {
            const done = (await query(`UPDATE payouts SET status='paid', paid_at=now(), note=NULL WHERE id=$1 RETURNING *`, [p.id])).rows[0];
            await audit({ query }, actorId, "payout.paid", "payout", p.id, { hash: prepared.hash, auto: actorId === "auto" });
            return { state: "paid", payout: done };
        }
        if (r.confirmed && !r.success) {
            const failed = await setState(p.id, "approved", "Transfer failed on-chain (reverted). Funds are still held.");
            await query("UPDATE payouts SET paid_ref=NULL WHERE id=$1", [p.id]);
            return { state: "queued", payout: { ...failed, paid_ref: null }, reason: "The transfer failed on-chain" };
        }
        return { state: "unconfirmed", payout: await setState(p.id, "sending", "Waiting for confirmation"), reason: "Not confirmed yet. It will usually land shortly. Check the hash." };
    });
}

/** Called right after a worker claims. Sends at once if it qualifies, else leaves it for staff. */
async function maybeAuto(payout) {
    const d = await autoDecision(payout);
    if (!d.ok) return { state: "review", payout, reason: d.reason };
    return sendPayout({ payoutId: payout.id, actorId: "auto" });
}

const link = (hash, method) => chain.explorer(method, hash);

/** Refresh the staff message, tell the worker, and flag anything staff must look at. */
async function announce(client, res) {
    const p = res.payout;
    const chId = p.channel_id || (await config.get("payout_channel_id")) || process.env.PAYOUT_CHANNEL_ID;
    let channel = null;
    try { channel = chId ? await client.channels.fetch(chId) : null; } catch (e) { /* no access */ }

    try {
        if (channel && p.message_id) {
            const m = await channel.messages.fetch(p.message_id);
            await m.edit({ embeds: [payoutEmbed(p)], components: payoutRow(p) });
        }
    } catch (e) { /* message gone */ }

    const dm = async text => { try { await (await client.users.fetch(p.discord_id)).send(text); } catch (e) { /* DMs closed */ } };
    const alert = async text => { try { if (channel) await channel.send({ content: text, allowedMentions: { parse: [] } }); } catch (e) { /* ignore */ } };

    if (res.state === "paid") {
        await dm(`💸 Your payout #${p.id} of ${fmt(p.amount_cents)} was sent.\n${link(p.paid_ref, p.method)}`);
        try {
            const bal = await chain.sender(p.method).balances();
            const s = await settings();
            const a = chain.asset(p.method);
            if (a && bal.tokenCents < s.lowCents) await alert(`🪫 Payout wallet is low on ${a.label}: **${fmt(bal.tokenCents)}** left. Top up \`${chain.address()}\` on that network.`);
        } catch (e) { /* balance is best effort */ }
    } else if (res.state === "queued") {
        await alert(`⚠️ Payout #${p.id} (${fmt(p.amount_cents)}) wasn't sent: ${res.reason}. Funds are held, and staff can press **Send** once it's fixed.`);
    } else if (res.state === "unconfirmed") {
        await alert(`🔎 Payout #${p.id} needs a check: ${res.reason}${p.paid_ref ? `\n${link(p.paid_ref, p.method)}` : ""}`);
    } else if (res.state === "rejected") {
        await alert(`❌ Payout #${p.id} was rejected: ${res.reason}. The funds went back to <@${p.discord_id}>.`);
        await dm(`❌ Your payout #${p.id} couldn't be sent because your saved wallet address isn't valid. Your funds are back in your earnings. Set a new one with /payout address.`);
    }
}

module.exports = { settings, autoDecision, sendPayout, maybeAuto, announce, sentLastDay };
