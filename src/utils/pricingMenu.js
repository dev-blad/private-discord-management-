const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require("discord.js");
const { query } = require("../db");
const catalog = require("../services/catalog");
const config = require("../services/config");

const MENU_TAB = "Pricing";
const COLOR = 0x5865f2;
const FOOTER = "Open a ticket to discuss your order!";

/** "<:Agility:883101132031934525>" -> { id, name, animated }, plain emoji -> { name } */
function parseEmoji(raw) {
    const s = String(raw || "").trim();
    const m = /^<(a?):(\w+):(\d+)>$/.exec(s);
    if (m) return { animated: Boolean(m[1]), name: m[2], id: m[3] };
    return s && s.length <= 8 && !/\s/.test(s) ? { name: s } : undefined;
}

/** One dropdown per Pricing-tab location (25 options max each), in sheet order. */
function buildMenus(entries, { emojis = true } = {}) {
    const byLocation = new Map();
    for (const e of entries) {
        const loc = e.data.location;
        if (!byLocation.has(loc)) byLocation.set(loc, []);
        byLocation.get(loc).push(e);
    }

    const rows = [];
    let locIndex = 0;
    for (const [loc, items] of byLocation) {
        const parts = Math.ceil(items.length / 25);
        for (let p = 0; p < parts; p++) {
            const slice = items.slice(p * 25, p * 25 + 25);
            const menu = new StringSelectMenuBuilder()
                .setCustomId(`pm:${locIndex}:${p}`)
                .setPlaceholder((parts > 1 ? `${loc} (${p + 1}/${parts})` : loc).slice(0, 150))
                .setMinValues(1).setMaxValues(1)
                .addOptions(slice.map(e => {
                    const opt = { label: e.name.slice(0, 100), value: e.key.slice(0, 100) };
                    const emoji = emojis ? parseEmoji(e.data.emoji) : undefined;
                    if (emoji) opt.emoji = emoji;
                    return opt;
                }));
            rows.push(new ActionRowBuilder().addComponents(menu));
        }
        locIndex++;
    }
    return rows;
}

/** Discord allows 5 rows per message. */
const chunkRows = (rows, size = 5) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, i * size + size));

async function findMenuItem(value) {
    const { rows } = await query(
        `SELECT * FROM catalog_entries WHERE lower(tab) = 'pricing' AND kind = 'menu'
         AND (name_key = $1 OR name_key LIKE $2) ORDER BY position LIMIT 1`,
        [value, `${value}%`]
    );
    const r = rows[0];
    return r ? { id: r.id, name: r.name, key: r.name_key, data: r.data } : null;
}

const chunkLines = (lines, max = 3900) => {
    const chunks = [];
    let cur = [], len = 0;
    for (const line of lines) {
        if (len + line.length + 1 > max && cur.length) { chunks.push(cur); cur = []; len = 0; }
        cur.push(line);
        len += line.length + 1;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
};

function formatRate(price) {
    return price < 0.01 ? `${(price * 1_000_000).toFixed(3)}K` : price.toFixed(3);
}

/** Build the private reply (one or more embeds) for a chosen menu item. */
async function buildReply(item) {
    const tab = await catalog.resolveTab(item.data.location);
    if (!tab) return { error: `No pricing data loaded for "${item.data.location}". Ask an admin to run !syncdatabase.` };
    const entries = await catalog.getTab(tab);
    const coin = await config.get("coin_emoji", "🪙");
    const gpRate = parseFloat(await config.get("gp_usd_rate", process.env.GP_USD_RATE || "0.18"));
    const emoji = String(item.data.emoji || "").trim();
    const title = `${emoji ? emoji + " " : ""}${item.name}`;
    const kind = entries[0]?.kind;

    if (kind === "quest") {
        const quests = entries.filter(e => catalog.norm(e.data.group) === catalog.norm(item.name));
        if (!quests.length) return { error: `No quests found in group "${item.name}"` };
        const lines = quests.map(q => `• **${q.name}** - $${q.data.price.toFixed(2)} | ${coin} ${(q.data.price / gpRate).toFixed(2)}M`);
        const chunks = chunkLines(lines);
        return {
            embeds: chunks.map((c, i) => {
                const e = new EmbedBuilder().setColor(COLOR)
                    .setTitle(chunks.length > 1 ? `${title} (Part ${i + 1}/${chunks.length})` : title)
                    .setDescription(c.join("\n")).setFooter({ text: FOOTER });
                if (i === 0 && item.data.thumbnail) e.setThumbnail(item.data.thumbnail);
                return e;
            })
        };
    }

    if (kind === "skill") {
        const skill = entries.find(e => e.key === catalog.norm(item.name));
        if (!skill) return { error: `Could not find "${item.name}" in the ${tab} sheet` };
        const groups = new Map();
        for (const c of skill.data.columns) {
            if (!groups.has(c.group)) groups.set(c.group, []);
            groups.get(c.group).push(c);
        }
        let d = skill.data.notes && skill.data.notes.length > 5 ? `__**Notes**__\n${skill.data.notes}\n\n` : "";
        for (const [group, cols] of groups) {
            d += `**${group}**\n`;
            for (const c of cols) d += `**[${c.start}-${c.end}]** ${formatRate(c.rate)} / XP \`${c.method}\`\n`;
            d += "\n";
        }
        const e = new EmbedBuilder().setColor(COLOR).setTitle(title)
            .setDescription(d.trim().slice(0, 4096) || "No pricing details available.").setFooter({ text: FOOTER });
        if (item.data.thumbnail) e.setThumbnail(item.data.thumbnail);
        return { embeds: [e] };
    }

    // standard block tabs (PvM, Raids, Minigames, ...)
    const block = entries.find(e => e.key === catalog.norm(item.name));
    if (!block) return { error: `Could not find "${item.name}" in ${tab}` };
    let d = block.data.notes && block.data.notes.length > 5 ? `__**Notes**__\n${block.data.notes}\n\n` : "";
    for (const o of block.data.options) {
        if (!(o.price > 0)) continue;
        const memo = o.memo ? ` ${o.memo}` : "";
        d += `• **${o.title}**${memo} - $${o.price.toFixed(2)} | ${coin} ${(o.price / gpRate).toFixed(2)}M\n`;
    }
    if (!d.trim()) return { error: `No pricing options found for "${item.name}"` };
    const e = new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(d.trim().slice(0, 4096)).setFooter({ text: FOOTER });
    const thumb = block.data.thumbnail || item.data.thumbnail;
    if (thumb) e.setThumbnail(thumb);
    return { embeds: [e] };
}

/** After a pick, put every dropdown on the posted message back to its placeholder. */
async function resetMenus(interaction) {
    try {
        const fresh = buildMenus(await catalog.getTab(MENU_TAB));
        const byId = new Map(fresh.map(r => [r.components[0].data.custom_id, r]));
        const rows = interaction.message.components
            .map(r => byId.get(r.components[0]?.customId))
            .filter(Boolean);
        if (rows.length) await interaction.message.edit({ components: rows });
    } catch (err) {
        console.log("⚠️ Could not reset dropdown:", err.message);
    }
}

async function handleSelect(interaction) {
    const item = await findMenuItem(interaction.values[0]);
    if (!item) return interaction.reply({ content: "❌ That option is no longer in the pricing list. Ask staff to repost the menu.", ephemeral: true });

    const reply = await buildReply(item);
    if (reply.error) return interaction.reply({ content: `❌ ${reply.error}`, ephemeral: true });

    await interaction.reply({ embeds: [reply.embeds[0]], ephemeral: true });
    for (const e of reply.embeds.slice(1)) await interaction.followUp({ embeds: [e], ephemeral: true });
    await resetMenus(interaction);
}

module.exports = { MENU_TAB, parseEmoji, buildMenus, chunkRows, findMenuItem, buildReply, handleSelect };
