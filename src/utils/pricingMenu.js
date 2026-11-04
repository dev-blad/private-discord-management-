const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
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

// Display order of the dropdowns (matches the live server). Locations not listed follow in sheet order.
const DEFAULT_ORDER = [
    "Skilling", "Bundles", "Ironman Gathering", "Minigames", "Combat Achievements", "PvM & Bossing",
    "Pets & Misc Boosting", "Raids", "Infernals, Firecapes & Quivers", "Questing", "Skilling Outfits",
    "Achievement Diaries & Combat Bundles", "Megascales & Mystic Chinning", "Endgame Kits", "Guaranteed Items"
];
const HEADER_PREFIX = "pm_header_";
const ITEMS_PER_MENU = 24; // the 25th slot is the collapsed "header" option

const orderKey = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * One dropdown per Pricing-tab location. The closed menu shows a default-selected
 * "header" option (location emoji + name); the items sit below it. After a pick the
 * message is edited so the menu falls back to the header.
 */
function buildMenus(entries, { emojis = true, order = DEFAULT_ORDER } = {}) {
    const byLocation = new Map();
    for (const e of entries) {
        const loc = e.data.location;
        if (!byLocation.has(loc)) byLocation.set(loc, []);
        byLocation.get(loc).push(e);
    }
    const rank = loc => { const i = order.findIndex(o => orderKey(o) === orderKey(loc)); return i === -1 ? order.length : i; };
    const locations = [...byLocation.keys()].map((loc, i) => ({ loc, i })).sort((a, b) => rank(a.loc) - rank(b.loc) || a.i - b.i);

    const rows = [];
    locations.forEach(({ loc }, locIndex) => {
        const items = byLocation.get(loc);
        const parts = Math.ceil(items.length / ITEMS_PER_MENU);
        for (let p = 0; p < parts; p++) {
            const slice = items.slice(p * ITEMS_PER_MENU, (p + 1) * ITEMS_PER_MENU);
            const headLabel = (parts > 1 ? `${loc} (${p + 1}/${parts})` : loc).slice(0, 100);
            const header = { label: headLabel, value: `${HEADER_PREFIX}${locIndex}_${p}`, default: true };
            const headEmoji = emojis ? parseEmoji(items[0].data.emoji) : undefined;
            if (headEmoji) header.emoji = headEmoji;

            const menu = new StringSelectMenuBuilder()
                .setCustomId(`pm:${locIndex}:${p}`)
                .setPlaceholder(headLabel.slice(0, 150))
                .setMinValues(1).setMaxValues(1)
                .addOptions([header, ...slice.map(e => {
                    const opt = { label: e.name.slice(0, 100), value: e.key.slice(0, 100) };
                    const emoji = emojis ? parseEmoji(e.data.emoji) : undefined;
                    if (emoji) opt.emoji = emoji;
                    return opt;
                })]);
            rows.push(new ActionRowBuilder().addComponents(menu));
        }
    });
    return rows;
}

/** Link buttons under the menus. Config pricing_link_1..5 = "Label | https://url | optional emoji". */
async function buildLinkRow() {
    const buttons = [];
    for (let n = 1; n <= 5; n++) {
        const raw = await config.get(`pricing_link_${n}`, "");
        const [label, url, emoji] = String(raw).split("|").map(x => x.trim());
        if (!label || !/^https?:\/\//.test(url || "")) continue;
        const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label.slice(0, 80)).setURL(url);
        const em = parseEmoji(emoji);
        if (em) b.setEmoji(em);
        buttons.push(b);
    }
    return buttons.length ? new ActionRowBuilder().addComponents(buttons) : null;
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

/** After a pick, put every dropdown on the posted message back to its header option. */
async function resetMenus(interaction) {
    try {
        const fresh = buildMenus(await catalog.getTab(MENU_TAB));
        const byId = new Map(fresh.map(r => [r.components[0].data.custom_id, r]));
        const rows = interaction.message.components.map(r => {
            const c = r.components[0];
            return byId.get(c?.customId) || ActionRowBuilder.from(r);
        });
        await interaction.message.edit({ components: rows });
    } catch (err) {
        console.log("⚠️ Could not reset dropdown:", err.message);
    }
}

async function handleSelect(interaction) {
    // Clicking the collapsed header itself does nothing except put the menu back.
    if (interaction.values[0].startsWith(HEADER_PREFIX)) {
        await interaction.deferUpdate();
        return resetMenus(interaction);
    }
    const item = await findMenuItem(interaction.values[0]);
    if (!item) return interaction.reply({ content: "❌ That option is no longer in the pricing list. Ask staff to repost the menu.", ephemeral: true });

    const reply = await buildReply(item);
    if (reply.error) return interaction.reply({ content: `❌ ${reply.error}`, ephemeral: true });

    await interaction.reply({ embeds: [reply.embeds[0]], ephemeral: true });
    for (const e of reply.embeds.slice(1)) await interaction.followUp({ embeds: [e], ephemeral: true });
    await resetMenus(interaction);
}

module.exports = { MENU_TAB, DEFAULT_ORDER, HEADER_PREFIX, parseEmoji, buildMenus, buildLinkRow, chunkRows, findMenuItem, buildReply, handleSelect };
