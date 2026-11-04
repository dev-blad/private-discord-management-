const { EmbedBuilder } = require("discord.js");
const catalog = require("../services/catalog");
const { getCalcSettings, withDiscount, footer } = require("../utils/calc");
const { UserError } = require("../utils/money");

const TAB = "Quests";
const norm = catalog.norm;
const normalizeSection = s => (s ? String(s).toLowerCase().replace("quests", "").trim() : "");

const GLOBAL_ALIASES = {
    p2p: "p2p", members: "p2p", f2p: "f2p", miniquest: "miniquest", rfd: "recipe for disaster"
};

/**
 * Resolve a comma list ("rum deal,dt1" or "f2p") to quests.
 * A query matches a whole section (F2P, P2P, ...) or one quest by name/alias.
 * A quest asked for twice is only counted once.
 */
function pickQuests(entries, queries) {
    const picked = [];
    const have = new Set();
    const add = (name, priceEach) => {
        if (have.has(norm(name))) return;
        have.add(norm(name));
        picked.push({ name, priceEach });
    };

    for (const raw of queries) {
        const q = GLOBAL_ALIASES[raw] || raw;
        const qNorm = normalizeSection(q);

        const section = qNorm
            ? entries.filter(e => {
                const s = normalizeSection(e.data.group);
                return s && (s === qNorm || s.includes(qNorm) || qNorm.includes(s));
            })
            : [];
        if (section.length) { section.forEach(e => add(e.name, e.data.price)); continue; }

        const match = entries.find(e => norm(e.name) === q || e.data.aliases.includes(q));
        if (match && match.data.price > 0) add(match.name, match.data.price);
    }
    return picked;
}

function buildQuestEmbed(message, list, discountPct, finalUsd, totalGp, page, totalPages) {
    const lines = ["`Discount : " + discountPct + "%`", "", "__**Requested Quests**__"];
    for (const q of list) lines.push("`" + q.name + "` – $" + q.priceEach.toFixed(2));
    lines.push("", `💰 **$${finalUsd.toFixed(2)}** | 🪙 **${totalGp.toFixed(2)}M**`);

    const f = footer(message);
    return new EmbedBuilder()
        .setColor(0x00ffcc)
        .setAuthor({ name: "Quests Calculator", iconURL: "https://oldschool.runescape.wiki/images/Quests.png" })
        .setThumbnail("https://oldschool.runescape.wiki/images/Quest_point_cape_%28t%29_detail.png?1179a")
        .setDescription(lines.join("\n").slice(0, 4000))
        .setFooter({ text: f.text + (totalPages > 1 ? ` • Page ${page} of ${totalPages}` : ""), iconURL: f.iconURL });
}

/** Split quests across embeds so none goes over ~3500 characters. */
function chunkQuests(list) {
    const chunks = [];
    let buf = [], len = 0;
    for (const q of list) {
        const line = "`" + q.name + "` – $" + q.priceEach.toFixed(2) + "\n";
        if (len + line.length > 3500 && buf.length) { chunks.push(buf); buf = []; len = 0; }
        buf.push(q);
        len += line.length;
    }
    if (buf.length) chunks.push(buf);
    return chunks;
}

module.exports = {
    name: "q",
    aliases: ["quest", "quests"],
    pickQuests, chunkQuests,
    async execute(message, args) {
        if (!args.length) throw new UserError("Usage: `!q <quest1,quest2,...>` (example: `!q rum deal,dt1` or `!q f2p`)");
        const queries = args.join(" ").split(",").map(norm).filter(Boolean);

        const list = pickQuests(await catalog.getTab(TAB), queries);
        if (!list.length) throw new UserError(`No quests or sections found for: ${queries.join(", ")}`);

        const { rate, discountPct } = await getCalcSettings(message.member);
        const finalUsd = withDiscount(list.reduce((n, q) => n + q.priceEach, 0), discountPct);
        const totalGp = finalUsd / rate;

        const chunks = chunkQuests(list);
        const embeds = chunks.map((c, i) => buildQuestEmbed(message, c, discountPct, finalUsd, totalGp, i + 1, chunks.length));
        return message.channel.send({ embeds: embeds.slice(0, 10) });
    }
};
