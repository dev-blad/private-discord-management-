const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const analytics = require("../services/analytics");
const { fmt } = require("../utils/money");
const { requireSupport } = require("../utils/perms");

const LABEL = { 7: "Last 7 days", 30: "Last 30 days", 90: "Last 90 days", 0: "All time" };

module.exports = {
    data: new SlashCommandBuilder()
        .setName("analytics")
        .setDescription("How the business is doing (staff)")
        .addIntegerOption(o => o.setName("period").setDescription("Time range (default 30 days)").addChoices(
            { name: "7 days", value: 7 }, { name: "30 days", value: 30 }, { name: "90 days", value: 90 }, { name: "All time", value: 0 })),

    async execute(interaction) {
        requireSupport(interaction.member);
        const period = interaction.options.getInteger("period") ?? 30;
        const a = await analytics.overview(period || null);
        const dep = a.deposits.length ? a.deposits.map(d => `${d.source}: ${fmt(Number(d.total))} (${d.n})`).join("\n") : "None yet";
        const top = a.topWorkers.length ? a.topWorkers.map((w, i) => `${i + 1}. <@${w.id}> ${fmt(Number(w.total))} (${w.jobs})`).join("\n") : "None yet";
        const e = new EmbedBuilder().setColor(0x3498db).setTitle(`📊 ${LABEL[period]}`).addFields(
            { name: "Jobs completed", value: String(a.jobs), inline: true },
            { name: "Revenue", value: fmt(a.revenue), inline: true },
            { name: "Average order", value: fmt(a.avgOrder), inline: true },
            { name: "Paid to workers", value: fmt(a.workers), inline: true },
            { name: "Support cuts", value: fmt(a.support), inline: true },
            { name: "House profit", value: `${fmt(a.house)} (${a.margin.toFixed(1)}%)`, inline: true },
            { name: "New customers", value: String(a.newCustomers), inline: true },
            { name: "Cancelled jobs", value: String(a.cancelled), inline: true },
            { name: "Deposits by source", value: dep },
            { name: "Top workers", value: top });
        return interaction.reply({ embeds: [e], ephemeral: true, allowedMentions: { parse: [] } });
    }
};
