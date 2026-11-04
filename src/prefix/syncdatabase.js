const { EmbedBuilder } = require("discord.js");
const catalog = require("../services/catalog");
const { requireAdmin } = require("../utils/perms");

const ICON = { ok: "✅", rejected: "⚠️", skipped: "⏭️", ignored: "▫️" };

module.exports = {
    name: "syncdatabase",
    aliases: ["syncdb"],
    async execute(message, args) {
        requireAdmin(message.member);
        const force = args.some(a => a.toLowerCase() === "force");

        const working = await message.reply("🔄 Syncing the pricing sheet…");
        const summary = await catalog.syncCatalog({ actorId: message.author.id, force });

        const shown = summary.tabs.filter(t => t.status !== "ignored");
        const lines = shown.map(t => {
            if (t.status === "ok") {
                const diff = t.entries - t.previous;
                const change = t.previous ? ` (${diff >= 0 ? "+" : ""}${diff})` : " (new)";
                return `${ICON.ok} **${t.tab}** — ${t.entries} entries${change}`;
            }
            return `${ICON[t.status]} **${t.tab}** — ${t.note}`;
        });

        const warnings = summary.tabs.flatMap(t => (t.warnings || []).map(w => `• ${w}`));
        const rejected = summary.tabs.some(t => t.status === "rejected");

        const embed = new EmbedBuilder()
            .setColor(rejected ? 0xffa000 : 0x00c853)
            .setTitle(rejected ? "Sync finished with problems" : "Sync complete")
            .setDescription((lines.join("\n") || "No pricing tabs found.").slice(0, 4000))
            .setFooter({ text: `${summary.totalEntries} entries loaded • ${(summary.ms / 1000).toFixed(1)}s` });

        if (warnings.length) {
            const body = warnings.slice(0, 12).join("\n") + (warnings.length > 12 ? `\n…and ${warnings.length - 12} more` : "");
            embed.addFields({ name: `Sheet warnings (${warnings.length})`, value: body.slice(0, 1000) });
        }

        await working.edit({ content: "", embeds: [embed] });
    }
};
