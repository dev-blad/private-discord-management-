// Builds the boss roster for the Christmas event from the pricing sheet (PvM + Raids tabs).
const { query, withTx } = require("../db");

const COMMON_MAX_CENTS = 15;   // bosses at or under $0.15/kill are common
const UNCOMMON_VALUE_CAP_CENTS = 1200; // an uncommon kill-count drop is worth at most ~$12
const SKIP_BLOCKS = /revenant/i;
const BLOCK_AS_ONE = /corrupted gauntlet|doom of mokhaiotl/i;
const RENAME = { "shamans": "Lizardman Shamans", "dagganoth kings": "Dagannoth Kings" };

/** "Chaos Elemental With BOFA" -> "Chaos Elemental", "Yama kc (Duo)" -> "Yama" */
function bossName(title) {
    let n = String(title).split("|")[0];
    n = n.split(/\s+\+\s+|\s+-\s+|\s*\(/)[0];
    n = n.replace(/\s+(with|w\/)\s+.*$/i, "");
    n = n.replace(/\s+(kc|solo|duo|only|whole rotation)$/i, "").replace(/\s+(kc|solo|duo|only)$/i, "").trim();
    return RENAME[n.toLowerCase()] || n;
}

const wikiImg = name => `https://oldschool.runescape.wiki/images/${encodeURIComponent(name.replace(/ /g, "_"))}.png`;

/** Pure: catalog tabs -> boss list. tabs = { pvm: [entries], raids: [entries] } */
function buildRoster(tabs) {
    const map = new Map();
    const add = (name, priceCents, tier, kc) => {
        const cur = map.get(name);
        if (!cur) map.set(name, { name, priceCents, tier, kc });
        else if (priceCents > 0 && (cur.priceCents <= 0 || priceCents < cur.priceCents)) cur.priceCents = priceCents;
    };
    const cents = o => Math.round((o.price || 0) * 100);
    const tierFor = c => (c > 0 && c <= COMMON_MAX_CENTS ? "common" : "uncommon");
    const kcFor = (tier, c) => tier === "common" ? 10 : Math.max(1, Math.min(25, Math.floor(UNCOMMON_VALUE_CAP_CENTS / Math.max(c, 1))));

    for (const e of tabs.pvm || []) {
        if (SKIP_BLOCKS.test(e.name)) continue;
        const opts = (e.data?.options || []).filter(o => o.price > 0);
        if (BLOCK_AS_ONE.test(e.name)) {
            const c = Math.min(...opts.map(cents));
            if (opts.length) { const t = tierFor(c); add(e.name.replace(/\s*\(.*\)/, "").trim().replace(/\bOf\b/, "of"), c, t, kcFor(t, c)); }
            continue;
        }
        for (const o of opts) {
            const c = cents(o);
            const n = bossName(o.title);
            if (n) { const t = tierFor(c); add(n, c, t, kcFor(t, c)); }
        }
    }
    for (const e of tabs.raids || []) {
        if (/challenge|entry|hmt|hard/i.test(e.name)) continue; // CM / HM have their own specialist boosters
        const opts = (e.data?.options || []).filter(o => o.price > 0);
        const c = opts.length ? Math.min(...opts.map(cents)) : 0;
        if (/chambers/i.test(e.name)) add("Chambers of Xeric", c, "rare", 5);
        else if (/theatre/i.test(e.name)) add("Theatre of Blood", c, "ultra", 3);
        else if (/tombs/i.test(e.name)) add("Tombs of Amascut", c, "ultra", 3);
    }
    return [...map.values()].map(b => ({ ...b, img: wikiImg(b.name) }));
}

/** Re-read the PvM and Raids tabs and upsert the roster. Staff overrides are kept. */
async function syncRoster() {
    const catalog = require("./catalog");
    const pvm = await catalog.getTab("PvM");
    const raids = await catalog.getTab("Raids");
    const roster = buildRoster({ pvm, raids });
    if (!roster.length) return { added: 0, total: 0 };
    let added = 0;
    await withTx(async c => {
        for (const b of roster) {
            const r = await c.query(
                `INSERT INTO boss_bosses (name, tier, kc, price_cents, img) VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (name) DO UPDATE SET tier=$2, kc=$3, price_cents=$4, in_sheet=TRUE,
                    img = CASE WHEN boss_bosses.img_custom IS NULL THEN $5 ELSE boss_bosses.img END
                 RETURNING (xmax = 0) AS inserted`,
                [b.name, b.tier, b.kc, b.priceCents, b.img]);
            if (r.rows[0].inserted) added++;
        }
        await c.query("UPDATE boss_bosses SET in_sheet=FALSE WHERE NOT (name = ANY($1))", [roster.map(b => b.name)]);
    });
    return { added, total: roster.length };
}

/** Effective view of a row (custom overrides win). */
const effective = r => ({
    id: r.id, name: r.name, price_cents: r.price_cents,
    tier: r.tier_custom || r.tier,
    kc: r.kc_custom ?? r.kc,
    img: r.img_custom || r.img
});

async function activeBosses(c = { query }) {
    const { rows } = await c.query("SELECT * FROM boss_bosses WHERE active AND in_sheet ORDER BY name");
    return rows.map(effective);
}

async function setBoss(name, { tier, kc, img, active }) {
    const { rows } = await query("SELECT * FROM boss_bosses WHERE lower(name) = lower($1)", [name]);
    if (!rows[0]) return null;
    const id = rows[0].id;
    if (tier !== undefined) await query("UPDATE boss_bosses SET tier_custom=$2 WHERE id=$1", [id, tier]);
    if (kc !== undefined) await query("UPDATE boss_bosses SET kc_custom=$2 WHERE id=$1", [id, kc]);
    if (img !== undefined) await query("UPDATE boss_bosses SET img_custom=$2 WHERE id=$1", [id, img]);
    if (active !== undefined) await query("UPDATE boss_bosses SET active=$2 WHERE id=$1", [id, active]);
    return effective((await query("SELECT * FROM boss_bosses WHERE id=$1", [id])).rows[0]);
}

module.exports = { bossName, buildRoster, syncRoster, activeBosses, setBoss, effective, COMMON_MAX_CENTS };
