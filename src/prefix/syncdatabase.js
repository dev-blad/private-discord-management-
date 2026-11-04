const { EmbedBuilder } = require("discord.js");
const catalog = require("../services/catalog");
const { requireAdmin } = require("../utils/perms");

const ICON = { ok: "✅", rejected: "⚠️", skipped: "⏭️", ignored: "▫️" };

function hint(r) {
    if (/PRICING_SHEET_ID/i.test(r)) return "\nSet `PRICING_SHEET_ID` on Railway.";
    if (/reading 'replace'|GOOGLE_PRIVATE_KEY/i.test(r)) return "\n`GOOGLE_PRIVATE_KEY` is missing on Railway.";
    if (/caller does not have permission|PERMISSION_DENIED|403/i.test(r)) return "\nShare the sheet with the service account email (Viewer).";
    if (/has not been used|SERVICE_DISABLED|accessNotConfigured/i.test(r)) return "\nEnable the Google Sheets API in Google Cloud.";
    if (/not found|404/i.test(r)) return "\nSheet not found. Check `PRICING_SHEET_ID`.";
    if (/DECODER|PEM|private key|invalid_grant|DNS|unsupported/i.test(r)) return "\nThe private key looks malformed. Re-paste it from the JSON file.";
    if (/catalog_entries|relation .* does not exist/i.test(r)) return "\nDatabase migration hasn't run. Redeploy the bot.";
    return "";
}

module.exports = {
    name: "syncdatabase",
    aliases: ["syncdb"],
    async execute(message, args) {
        requireAdmin(message.member);
        const force = args.some(a => a.toLowerCase() === "force");

        const working = await message.reply("🔄 Syncing the pricing sheet…");
        let summary;
        try {
            summary = await catalog.syncCatalog({ actorId: message.author.id, force });
        } catch (err) {
            console.error("[syncdatabase] failed:", err);
            // Admin-only command, so show the cause (never includes secrets).
            const reason = String(err?.message || err).replace(/-----BEGIN[\s\S]*?END PRIVATE KEY-----/g, "[key]").slice(0, 900);
            await working.edit({ content: `❌ Sync failed:\n\`\`\`${reason}\`\`\`${hint(reason)}` });
            return;
        }

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
