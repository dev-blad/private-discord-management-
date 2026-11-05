const config = require("../services/config");
const pricing = require("../services/pricing");
const { UserError } = require("./money");

/** lowercase with all whitespace removed, for forgiving alias matching */
const squash = s => String(s ?? "").toLowerCase().replace(/\s+/g, "").trim();

/**
 * GP rate and the caller's discount.
 * Discount = the best spend-tier role they hold (see /config discount_*_N);
 * otherwise a flat role discount (config discount_role_id / discount_pct,
 * falling back to DISCOUNT_ROLE_ID / DEFAULT_DISCOUNT_PCT like the old bot).
 */
async function getCalcSettings(member) {
    const rate = parseFloat(await config.get("gp_usd_rate", process.env.GP_USD_RATE || "0.18"));
    if (!(rate > 0)) throw new UserError("GP rate is not set correctly. An admin can fix it with `/config set gp_usd_rate 0.18`.");

    let discountPct = 0;
    for (const t of await pricing.tiers()) {
        if (t.role && t.percent > discountPct && member?.roles?.cache?.has(t.role)) discountPct = t.percent;
    }
    if (!discountPct) {
        const roleId = await config.get("discount_role_id", process.env.DISCOUNT_ROLE_ID || "");
        const pct = parseFloat(await config.get("discount_pct", process.env.DEFAULT_DISCOUNT_PCT || "2.0"));
        if (roleId && member?.roles?.cache?.has(roleId) && Number.isFinite(pct)) discountPct = pct;
    }
    return { rate, discountPct };
}

/** "dt2 5" -> { query: "dt2", amount: 5 };  "blood torva" -> { query: "blood torva", amount: 1 } */
function splitAmount(args) {
    const parts = [...args];
    let amount = 1;
    if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) amount = parseInt(parts.pop(), 10);
    if (amount < 1 || amount > 1_000_000) throw new UserError("Invalid amount. Must be a positive number.");
    return { query: parts.join(" "), amount };
}

const withDiscount = (usd, pct) => (pct > 0 ? usd * (1 - pct / 100) : usd);

/**
 * Find a block (or one option inside it) in a tab like PvM / Raids / Kits.
 *  1. exact: the query equals a block alias, a block name, or an option alias
 *  2. loose: an alias contains the query (the old bot's behaviour)
 * Returns { entry, option } where option is null when the whole block matched.
 */
function lookupInBlocks(entries, rawQuery) {
    const q = squash(rawQuery);
    if (!q) return null;

    for (const entry of entries) {
        if (entry.data.aliases.some(a => squash(a) === q) || squash(entry.name) === q) return { entry, option: null };
        const option = entry.data.options.find(o => o.aliases.some(a => squash(a) === q));
        if (option) return { entry, option };
    }
    for (const entry of entries) {
        if (q.length >= 3 && entry.data.aliases.some(a => squash(a).includes(q))) return { entry, option: null };
        const option = entry.data.options.find(o => o.aliases.some(a => squash(a).includes(q)));
        if (option) return { entry, option };
    }
    return null;
}

/** options with a usable price, for a block or a single option */
const pricedOptions = entry => entry.data.options.filter(o => o.price && o.price > 0);

/** Boxed header lines: `Label    : value` (one code span per line, colons aligned). */
function header(pairs) {
    const list = pairs.filter(p => p && p[1] !== null && p[1] !== undefined && p[1] !== "");
    const w = Math.max(...list.map(p => String(p[0]).length), 1);
    return list.map(([l, v]) => "`" + String(l).padEnd(w) + " : " + v + "`").join("\n");
}

/** One priced line in the shared look: `Title` – $usd | 🪙 gpM */
const priceLine = (title, usd, gp) => "`" + title + "` – $" + usd.toFixed(2) + " | 🪙 " + gp.toFixed(2) + "M";

/** Shared body for !b / !raids / !kits: header, notes, then one line per priced option. Null if nothing priced. */
function describeBlock({ entry, option }, amount, discountPct, rate, headerPairs) {
    const shown = option ? [option] : pricedOptions(entry);
    if (!shown.length || shown.some(o => !(o.price > 0))) return null;
    let d = header([...headerPairs, ["Amount", amount], ["Discount", discountPct + "%"]]) + "\n\n";
    if (entry.data.notes) d += `__**Notes**__\n${entry.data.notes}\n\n`;
    d += "__**Prices**__\n";
    d += shown.map(o => {
        const usd = withDiscount(o.price * amount, discountPct);
        return priceLine(o.title, usd, usd / rate);
    }).join("\n");
    return d;
}

const footer = message => ({
    text: message.guild?.name || " ",
    iconURL: message.guild?.iconURL?.() || undefined
});

module.exports = { squash, getCalcSettings, splitAmount, withDiscount, lookupInBlocks, pricedOptions, footer, header, priceLine, describeBlock };
