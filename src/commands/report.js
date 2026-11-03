const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const reports = require("../services/reports");
const { fmt } = require("../utils/money");
const { requireSupport, requireAdmin } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("report")
        .setDescription("Business reports")
        .addSubcommand(s => s.setName("summary").setDescription("Revenue, profit, what's owed (staff)"))
        .addSubcommand(s => s.setName("leaderboard").setDescription("Top customers or workers")
            .addStringOption(o => o.setName("type").setDescription("Who to rank").addChoices(
                { name: "customers", value: "customers" }, { name: "workers", value: "workers" })))
        .addSubcommand(s => s.setName("export").setDescription("Download a CSV export (admin)")
            .addStringOption(o => o.setName("table").setDescription("What to export").setRequired(true)
                .addChoices(...reports.EXPORT_NAMES.map(n => ({ name: n, value: n }))))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === "summary") {
            requireSupport(interaction.member);
            const r = await reports.summary();
            const e = new EmbedBuilder().setTitle("📈 Business summary").setColor(0x9b59b6).addFields(
                { name: "Jobs", value: `${r.open_jobs} open · ${r.claimed_jobs} claimed · ${r.completed_jobs} completed` },
                { name: "Revenue (completed)", value: fmt(r.revenue_cents), inline: true },
                { name: "House profit", value: fmt(r.profit_cents), inline: true },
                { name: "Paid to workers (earned)", value: fmt(r.worker_cents), inline: true },
                { name: "In escrow (open jobs)", value: fmt(r.escrow_cents), inline: true },
                { name: "Customer balances held", value: fmt(r.customer_balances), inline: true },
                { name: "Owed to workers", value: fmt(r.owed_to_workers), inline: true },
                { name: "Payouts pending", value: `${r.pending_count} (${fmt(r.pending_cents)})`, inline: true },
                { name: "Payouts paid out", value: fmt(r.paid_cents), inline: true });
            return interaction.reply({ embeds: [e], ephemeral: true });
        }

        if (sub === "leaderboard") {
            const type = interaction.options.getString("type") || "customers";
            const rows = await reports.leaderboard(type);
            const text = rows.length
                ? rows.map((r, i) => `**${i + 1}.** <@${r.id}> — ${fmt(r.total)} (${r.jobs} jobs)`).join("\n")
                : "Nothing to show yet.";
            return interaction.reply({ content: `🏆 **Top ${type}**\n${text}`, allowedMentions: { parse: [] } });
        }

        requireAdmin(interaction.member);
        const table = interaction.options.getString("table");
        const csv = await reports.exportCsv(table);
        return interaction.reply({
            content: `📄 ${table} export`,
            files: [new AttachmentBuilder(Buffer.from(csv), { name: `${table}-${new Date().toISOString().slice(0, 10)}.csv` })],
            ephemeral: true
        });
    }
};
