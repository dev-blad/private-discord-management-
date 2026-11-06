const { query, withTx } = require("../db");
const config = require("./config");
const { UserError, fmt } = require("../utils/money");
const { applyLedger } = require("./wallets");

const RARITIES = ["common", "uncommon", "rare", "ultra"];
const DEFAULT_WEIGHTS = { common: 60, uncommon: 25, rare: 10, ultra: 5 };
const DEFAULT_BOSSES = {
    common: { name: "General Graardor", img: "https://oldschool.runescape.wiki/images/General_Graardor.png" },
    uncommon: { name: "Zulrah", img: "https://oldschool.runescape.wiki/images/Zulrah_%28serpentine%29.png" },
    rare: { name: "Vorkath", img: "https://oldschool.runescape.wiki/images/Vorkath.png" },
    ultra: { name: "Nex", img: "https://oldschool.runescape.wiki/images/Nex.png" }
};
const COLORS = { common: 0x95a5a6, uncommon: 0x2ecc71, rare: 0x3498db, ultra: 0xe91e63 };

const enabled = async () => (await config.get("boss_enabled", "false")) === "true";
const usdPerToken = async () => parseFloat(await config.get("boss_usd_per_token", "25")) || 0;

async function weights() {
    const out = {};
    for (const r of RARITIES) {
        const v = parseFloat(await config.get(`boss_weight_${r}`, String(DEFAULT_WEIGHTS[r])));
        out[r] = v > 0 ? v : 0;
    }
    return out;
}

async function bossFor(rarity) {
    const d = DEFAULT_BOSSES[rarity];
    return {
        name: await config.get(`boss_name_${rarity}`, d.name),
        img: await config.get(`boss_img_${rarity}`, d.img),
        color: COLORS[rarity]
    };
}

/** Called inside completeJob's transaction. Returns how many tokens the customer just earned. */
async function grantForSpend(c, discordId, cents) {
    if (!(await enabled())) return 0;
    const per = Math.round((await usdPerToken()) * 100);
    if (per <= 0 || cents <= 0) return 0;
    await c.query("INSERT INTO boss_tokens (discord_id) VALUES ($1) ON CONFLICT DO NOTHING", [discordId]);
    const { rows } = await c.query("SELECT progress_cents FROM boss_tokens WHERE discord_id=$1 FOR UPDATE", [discordId]);
    const total = Number(rows[0].progress_cents) + cents;
    const earned = Math.floor(total / per);
    await c.query(
        "UPDATE boss_tokens SET progress_cents=$2, tokens=tokens+$3, earned_total=earned_total+$3 WHERE discord_id=$1",
        [discordId, total % per, earned]);
    return earned;
}

async function give({ discordId, amount, actorId }) {
    await query("INSERT INTO boss_tokens (discord_id) VALUES ($1) ON CONFLICT DO NOTHING", [discordId]);
    const { rows } = await query(
        "UPDATE boss_tokens SET tokens=tokens+$2, earned_total=earned_total+$2 WHERE discord_id=$1 RETURNING tokens",
        [discordId, amount]);
    await require("./audit").audit({ query }, actorId, "boss.give", "user", discordId, { amount });
    return rows[0].tokens;
}

async function status(discordId) {
    const { rows } = await query("SELECT * FROM boss_tokens WHERE discord_id=$1", [discordId]);
    const r = rows[0] || { tokens: 0, progress_cents: 0, earned_total: 0, kills: 0 };
    return { tokens: r.tokens, progressCents: Number(r.progress_cents), earnedTotal: r.earned_total, kills: r.kills, perCents: Math.round((await usdPerToken()) * 100) };
}

function weightedPick(items, w) {
    const total = items.reduce((n, i) => n + w(i), 0);
    let roll = Math.random() * total;
    for (const i of items) { roll -= w(i); if (roll < 0) return i; }
    return items[items.length - 1];
}

/** Share (percent) of a boss's drops that is its own kill count. */
const kcShare = async () => {
    const v = parseFloat(await config.get("boss_kc_pct", "40"));
    return v >= 0 && v < 100 ? v : 40;
};

/** Bosses of a tier; falls back to the single configured boss when the roster isn't synced yet. */
async function bossesOfTier(tier) {
    const r = await require("./bossroster").activeBosses();
    const own = r.filter(b => b.tier === tier);
    return own.length ? own : [{ ...(await bossFor(tier)), kc: 0 }];
}
function bossesOf(roster, tier) {
    const own = roster.filter(b => b.tier === tier);
    return own.length ? own : [{ name: DEFAULT_BOSSES[tier].name, img: DEFAULT_BOSSES[tier].img, kc: 0 }];
}

/** Spend `amount` tokens, roll bosses and prizes. All-or-nothing. */
async function kill({ discordId, amount = 1 }) {
    if (!(await enabled())) throw new UserError("The boss event isn't running right now.");
    const w = await weights();
    return withTx(async c => {
        const { rows } = await c.query("SELECT tokens FROM boss_tokens WHERE discord_id=$1 FOR UPDATE", [discordId]);
        const have = rows[0]?.tokens || 0;
        if (have < amount) throw new UserError(have ? `You only have ${have} boss token${have === 1 ? "" : "s"}.` : "You have no boss tokens. You earn them by completing orders.");

        const drops = [];
        const roster = await require("./bossroster").activeBosses(c);
        const kcPct = await kcShare();
        for (let i = 0; i < amount; i++) {
            const { rows: prizes } = await c.query(
                "SELECT * FROM boss_prizes WHERE active AND (stock IS NULL OR stock > 0) FOR UPDATE");
            const live = RARITIES.filter(r => w[r] > 0 && (prizes.some(p => p.rarity === r) || roster.some(b => b.tier === r && b.kc > 0)));
            if (!live.length) throw new UserError("The loot tables are empty right now. Ask staff.");
            const rarity = weightedPick(live, r => w[r]);

            const pool = bossesOf(roster, rarity);
            const boss = weightedPick(pool, () => 1);
            const generic = prizes.filter(p => p.rarity === rarity);
            let prize = null;
            const gw = generic.reduce((n, p) => n + p.weight, 0);
            const kcW = boss.kc > 0 ? (gw > 0 ? gw * kcPct / (100 - kcPct) : 1) : 0;
            if (kcW > 0 && Math.random() * (gw + kcW) < kcW) {
                prize = { id: null, kind: "item", name: `${boss.kc} ${boss.name} kills`, credit_cents: 0, discount_pct: 0 };
            } else {
                if (!generic.length) throw new UserError("The loot tables are empty right now. Ask staff.");
                prize = weightedPick(generic, p => p.weight);
                if (prize.stock !== null) await c.query("UPDATE boss_prizes SET stock = stock - 1 WHERE id=$1", [prize.id]);
            }
            const auto = prize.kind === "credit" || prize.kind === "discount";
            const { rows: d } = await c.query(
                `INSERT INTO boss_drops (discord_id, prize_id, rarity, prize_name, kind, credit_cents, redeemed, redeemed_at, redeemed_by, boss_name)
                 VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN 'auto' END, $8) RETURNING *`,
                [discordId, prize.id, rarity, prize.name, prize.kind, prize.credit_cents, auto, boss.name]);
            if (prize.kind === "discount") {
                await c.query("INSERT INTO customer_discounts (discord_id, percent, source) VALUES ($1,$2,$3)",
                    [discordId, prize.discount_pct, `Boss drop #${d[0].id}`]);
            }
            if (prize.kind === "credit" && prize.credit_cents > 0) {
                await applyLedger(c, {
                    discordId, bucket: "balance", delta: prize.credit_cents, kind: "event_prize",
                    note: `Boss drop #${d[0].id}: ${prize.name}`, source: "boss_event"
                });
            }
            drops.push({ ...d[0], boss });
        }
        await c.query("UPDATE boss_tokens SET tokens=tokens-$2, kills=kills+$2 WHERE discord_id=$1", [discordId, amount]);
        return drops;
    });
}

async function myDrops(discordId, limit = 15) {
    return (await query("SELECT * FROM boss_drops WHERE discord_id=$1 ORDER BY id DESC LIMIT $2", [discordId, limit])).rows;
}

async function pendingItems(limit = 25) {
    return (await query("SELECT * FROM boss_drops WHERE kind='item' AND NOT redeemed ORDER BY id LIMIT $1", [limit])).rows;
}

async function redeem({ dropId, actorId }) {
    const { rows } = await query(
        `UPDATE boss_drops SET redeemed=TRUE, redeemed_by=$2, redeemed_at=now()
         WHERE id=$1 AND kind='item' AND NOT redeemed RETURNING *`, [dropId, actorId]);
    if (!rows.length) throw new UserError(`Drop #${dropId} isn't an unredeemed item prize.`);
    return rows[0];
}

async function listPrizes() {
    return (await query("SELECT * FROM boss_prizes ORDER BY array_position(ARRAY['common','uncommon','rare','ultra'], rarity), id")).rows;
}

async function addPrize({ rarity, name, kind, creditCents = 0, discountPct = 0, roleName = null, stock = null, weight = 1 }) {
    if (kind === "credit" && creditCents <= 0) throw new UserError("Wallet credit prizes need an amount.");
    if (kind === "discount" && !(discountPct >= 1 && discountPct <= 100)) throw new UserError("Discount prizes need a percent from 1 to 100.");
    if (kind === "role" && !roleName) throw new UserError("Role prizes need a role name.");
    const { rows } = await query(
        `INSERT INTO boss_prizes (rarity, name, kind, credit_cents, discount_pct, role_name, stock, weight) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [rarity, name, kind, kind === "credit" ? creditCents : 0, kind === "discount" ? discountPct : 0, kind === "role" ? roleName : null, stock, weight]);
    return rows[0];
}

async function removePrize(id) {
    const { rows } = await query("UPDATE boss_prizes SET active=FALSE WHERE id=$1 AND active RETURNING *", [id]);
    if (!rows.length) throw new UserError(`Prize #${id} doesn't exist or is already removed.`);
    return rows[0];
}

/** Expected wallet credit per token, from the live tables and rarity weights. */
async function expectedValue() {
    const w = await weights();
    const kcPct = await kcShare();
    const prizes = (await query("SELECT * FROM boss_prizes WHERE active AND (stock IS NULL OR stock > 0)")).rows;
    const roster = await require("./bossroster").activeBosses();
    const live = RARITIES.filter(r => w[r] > 0 && (prizes.some(p => p.rarity === r) || roster.some(b => b.tier === r && b.kc > 0)));
    const wTotal = live.reduce((n, r) => n + w[r], 0);
    const perRarity = {};
    let ev = 0;
    for (const r of live) {
        const ps = prizes.filter(p => p.rarity === r);
        const pw = ps.reduce((n, p) => n + p.weight, 0);
        const hasKc = roster.some(b => b.tier === r && b.kc > 0);
        const kcW = hasKc ? (pw > 0 ? pw * kcPct / (100 - kcPct) : 1) : 0;
        const avg = pw + kcW > 0 ? ps.reduce((n, p) => n + p.credit_cents * p.weight, 0) / (pw + kcW) : 0;
        perRarity[r] = { chance: w[r] / wTotal, avgCents: avg, kcChance: pw + kcW > 0 ? kcW / (pw + kcW) : 0, bosses: roster.filter(b => b.tier === r).length };
        ev += (w[r] / wTotal) * avg;
    }
    const per = Math.round((await usdPerToken()) * 100);
    return { evCents: ev, perRarity, perCents: per, payoutPct: per > 0 ? (ev / per) * 100 : null };
}

async function stats() {
    const t = (await query("SELECT COALESCE(sum(earned_total),0)::int earned, COALESCE(sum(kills),0)::int kills, COALESCE(sum(tokens),0)::int unused, count(*)::int players FROM boss_tokens")).rows[0];
    const c = (await query("SELECT COALESCE(sum(credit_cents),0)::bigint cents FROM boss_drops WHERE kind='credit'")).rows[0];
    const byR = (await query("SELECT rarity, count(*)::int n FROM boss_drops GROUP BY 1")).rows;
    const items = (await query("SELECT count(*) FILTER (WHERE NOT redeemed)::int pending, count(*)::int total FROM boss_drops WHERE kind='item'")).rows[0];
    return { ...t, creditCents: Number(c.cents), byRarity: Object.fromEntries(byR.map(r => [r.rarity, r.n])), items };
}

module.exports = {
    RARITIES, COLORS, bossesOfTier, kcShare, enabled, usdPerToken, weights, bossFor, grantForSpend, give, status, kill,
    myDrops, pendingItems, redeem, listPrizes, addPrize, removePrize, expectedValue, stats, fmt
};
