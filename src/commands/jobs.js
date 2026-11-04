const { SlashCommandBuilder } = require("discord.js");
const jobs = require("../services/jobs");
const board = require("../utils/board");
const { fmt, UserError } = require("../utils/money");
const { requireSupport } = require("../utils/perms");
const { jobMessage } = require("../utils/embeds");

const idOpt = o => o.setName("id").setDescription("Job number").setMinValue(1).setRequired(true);

module.exports = {
    data: new SlashCommandBuilder()
        .setName("job")
        .setDescription("Manage jobs")
        .addSubcommand(s => s.setName("cancel").setDescription("Cancel a job and refund the customer (staff)").addIntegerOption(idOpt))
        .addSubcommand(s => s.setName("info").setDescription("Show a job").addIntegerOption(idOpt))
        .addSubcommand(s => s.setName("list").setDescription("List recent jobs")
            .addStringOption(o => o.setName("status").setDescription("Filter by status").addChoices(
                { name: "open", value: "open" }, { name: "claimed", value: "claimed" },
                { name: "completed", value: "completed" }, { name: "cancelled", value: "cancelled" }))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        const id = interaction.options.getInteger("id");

        if (sub === "cancel") {
            requireSupport(interaction.member);
            const job = await jobs.cancelJob({ jobId: id, actorId: interaction.user.id });
            await refreshBoard(interaction.client, job);
            return interaction.reply({ content: `✅ Job #${id} cancelled and ${fmt(job.price_cents)} refunded to <@${job.customer_id}>.`, ephemeral: true });
        }

        if (sub === "info") {
            const job = await jobs.getJob(id);
            if (!job) throw new UserError(`Job #${id} doesn't exist.`);
            const m = await jobMessage(interaction.client, job, interaction.guild);
            return interaction.reply({ embeds: m.embeds, ephemeral: true });
        }

        if (sub === "list") {
            const rows = await jobs.listJobs({ status: interaction.options.getString("status") });
            const text = rows.length
                ? rows.map(j => `**#${j.id}** \`${j.status.padEnd(9)}\` ${fmt(j.price_cents)} · <@${j.customer_id}>${j.worker_id ? ` → <@${j.worker_id}>` : ""}`).join("\n")
                : "No jobs found.";
            return interaction.reply({ embeds: [new (require("discord.js").EmbedBuilder)().setColor(0x00ae86).setTitle("Jobs").setDescription(text)
                .setFooter({ text: interaction.guild?.name || " ", iconURL: interaction.guild?.iconURL?.() || undefined })], ephemeral: true });
        }
    }
};

const refreshBoard = (client, job) => board.moveBoard(client, job);
module.exports.refreshBoard = refreshBoard;
