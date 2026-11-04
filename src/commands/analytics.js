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
        const { section } = require("../utils/box");
        const dep = a.deposits.length ? a.deposits.map(d => [d.source, `${fmt(Number(d.total))} (${d.n})`]) : [["None yet", "-"]];
        const top = a.topWorkers.length ? a.topWorkers.map((w, i) => `${i + 1}. <@${w.id}> ${fmt(Number(w.total))} (${w.jobs})`).join("\n") : "None yet";
        const e = new EmbedBuilder().setColor(0x3498db).setTitle(`📊 ${LABEL[period]}`).setDescription(
            section("Orders", [["Completed", a.jobs], ["Cancelled", a.cancelled], ["New customers", a.newCustomers], ["Average order", fmt(a.avgOrder)]], 14) + "\n\n" +
            section("Money", [["Revenue", fmt(a.revenue)], ["Workers", fmt(a.workers)], ["Support cuts", fmt(a.support)],
                ["House profit", `${fmt(a.house)} (${a.margin.toFixed(1)}%)`]], 14) + "\n\n" +
            section("Account sales", [["Sold", a.accountSales.count], ["Revenue", fmt(a.accountSales.revenue)]], 14) + "\n\n" +
            section("Deposits by source", dep, 14) + `\n\n**Top workers**\n${top}`)
            .setFooter({ text: interaction.guild?.name || " ", iconURL: interaction.guild?.iconURL?.() || undefined }).setTimestamp();
        return interaction.reply({ embeds: [e], ephemeral: true, allowedMentions: { parse: [] } });
    }
};
