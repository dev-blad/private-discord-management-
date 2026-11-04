const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const jobs = require("../services/jobs");
const { fmt, UserError } = require("../utils/money");
const { requireSupport } = require("../utils/perms");
const { jobMessage } = require("../utils/embeds");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("order")
        .setDescription("Look up orders (staff)")
        .addSubcommand(s => s.setName("info").setDescription("Show an order")
            .addIntegerOption(o => o.setName("id").setDescription("Order number").setMinValue(1).setRequired(true)))
        .addSubcommand(s => s.setName("list").setDescription("List recent orders")
            .addStringOption(o => o.setName("status").setDescription("Filter by status").addChoices(
                { name: "open", value: "open" }, { name: "claimed", value: "claimed" },
                { name: "completed", value: "completed" }, { name: "cancelled", value: "cancelled" }))),

    async execute(interaction) {
        requireSupport(interaction.member);
        const sub = interaction.options.getSubcommand();

        if (sub === "info") {
            const id = interaction.options.getInteger("id");
            const job = await jobs.getJob(id);
            if (!job) throw new UserError(`Order #${id} doesn't exist.`);
            const m = await jobMessage(interaction.client, job, interaction.guild);
            return interaction.reply({ embeds: m.embeds, ephemeral: true });
        }

        const rows = await jobs.listJobs({ status: interaction.options.getString("status") });
        const text = rows.length
            ? rows.map(j => `**#${j.id}** \`${j.status.padEnd(9)}\` ${fmt(j.price_cents)} · <@${j.customer_id}>${j.worker_id ? ` → <@${j.worker_id}>` : ""}`).join("\n")
            : "No orders found.";
        return interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x00ae86).setTitle("Orders").setDescription(text)
                .setFooter({ text: interaction.guild?.name || " ", iconURL: interaction.guild?.iconURL?.() || undefined })],
            ephemeral: true
        });
    }
};
