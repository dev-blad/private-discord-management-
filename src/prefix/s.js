const { EmbedBuilder } = require("discord.js");
const catalog = require("../services/catalog");
const { getCalcSettings, withDiscount, footer } = require("../utils/calc");
const { getXpRequired } = require("../utils/xp");
const { skillIcons } = require("../utils/skillIcons");
const { UserError } = require("../utils/money");

const TAB = "Skilling";

const SHORT = {
    wc: "woodcutting", fm: "firemaking", rc: "runecrafting", fletch: "fletching", cons: "construction",
    con: "construction", hp: "hitpoints", def: "defence", defense: "defence", str: "strength",
    atk: "attack", range: "ranged", herb: "herblore", thiev: "thieving", agi: "agility",
    mine: "mining", fish: "fishing", cook: "cooking", craft: "crafting", smith: "smithing",
    pray: "prayer", slay: "slayer", farm: "farming", hunt: "hunter", mage: "magic"
};

const wrapMethod = m => {
    const s = String(m || "").trim();
    if (!s) return "";
    return s.startsWith("(") && s.endsWith(")") ? s : `(${s})`;
};

/** "wc" / "woodcut" / "Woodcutting" -> the skill's entry, or null */
async function resolveSkill(input) {
    const q = catalog.norm(input);
    const skills = await catalog.getTab(TAB);
    const wanted = SHORT[q] || q;
    const exact = skills.find(s => s.key === wanted);
    if (exact) return exact;
    const prefix = skills.filter(s => s.key.startsWith(wanted));
    return prefix.length === 1 ? prefix[0] : null;
}

/**
 * Price a level range for one skill entry. Pure, so it can be tested.
 * Returns groups: [{ name, segments: [{ label, xp, usd }], totalUsd }]
 */
function priceRange(entry, reqStart, reqEnd) {
    const groups = new Map();
    for (const c of entry.data.columns) {
        const clipStart = Math.max(c.start, reqStart);
        const clipEnd = Math.min(c.end, reqEnd);
        if (clipStart >= clipEnd || clipEnd > 99) continue;
        const xp = getXpRequired(clipStart, clipEnd);
        const usd = xp * c.rate;
        if (!groups.has(c.group)) groups.set(c.group, { name: c.group, segments: [], totalUsd: 0 });
        const g = groups.get(c.group);
        g.segments.push({ label: `${clipStart}-${clipEnd} ${wrapMethod(c.method)}`.trim(), xp, usd });
        g.totalUsd += usd;
    }
    return [...groups.values()];
}

function describe(entry, reqStart, reqEnd, groups, discountPct, rate) {
    let d = "`Start    : " + reqStart + "`\n";
    d += "`Stop     : " + reqEnd + "`\n";
    if (discountPct > 0) d += "`Discount : " + discountPct + "%`\n";
    d += "\n";
    if (entry.data.notes) d += `__**Notes**__\n${entry.data.notes}\n\n`;
    for (const g of groups) {
        const total = withDiscount(g.totalUsd, discountPct);
        d += `__${g.name}__\n`;
        for (const s of g.segments) d += `\`${s.label}\` XP: ${s.xp.toLocaleString("en-US")}\n`;
        d += `💰 **$${total.toFixed(2)}** | 🪙 **${Math.round(total / rate)}M**\n\n`;
    }
    return d.trim();
}

module.exports = {
    name: "s",
    aliases: ["skill", "skills"],
    priceRange, describe, resolveSkill,
    async execute(message, args) {
        const [skillArg, range] = args;
        if (!skillArg || !range) throw new UserError("Usage: `!s skill start-end` (example: `!s slayer 45-87`)");

        const [a, b] = range.split(/[-–—]/);
        const reqStart = parseInt(a, 10), reqEnd = parseInt(b, 10);
        if (isNaN(reqStart) || isNaN(reqEnd) || reqStart < 1 || reqEnd > 99 || reqStart >= reqEnd) {
            throw new UserError("Invalid level range. Must be like `1-99`.");
        }

        const entry = await resolveSkill(skillArg);
        if (!entry) throw new UserError(`Skill "${skillArg}" not found in sheet.`);

        const { rate, discountPct } = await getCalcSettings(message.member);
        const groups = priceRange(entry, reqStart, reqEnd);
        if (!groups.length) throw new UserError(`No segments for ${entry.name} overlap ${reqStart}-${reqEnd}.`);

        const icons = skillIcons(entry.name);
        const embed = new EmbedBuilder()
            .setColor(0x00ffcc)
            .setAuthor({ name: `${entry.name.charAt(0).toUpperCase() + entry.name.slice(1)} Calculator`, iconURL: icons.icon || null })
            .setDescription(describe(entry, reqStart, reqEnd, groups, discountPct, rate).slice(0, 4096))
            .setThumbnail(icons.cape || null)
            .setFooter(footer(message));
        return message.reply({ embeds: [embed] });
    }
};
