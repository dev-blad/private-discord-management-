const { SlashCommandBuilder } = require("discord.js");
const jobs = require("../services/jobs");
const board = require("../utils/board");
const { toCents, fmt, UserError } = require("../utils/money");
const { requireSupport } = require("../utils/perms");
const { jobMessage } = require("../utils/embeds");
const { applySpendRole } = require("../utils/roles");

const idOpt = o => o.setName("id").setDescription("Job number").setMinValue(1).setRequired(true);

module.exports = {
    data: new SlashCommandBuilder()
        .setName("job")
        .setDescription("Manage jobs")
        .addSubcommand(s => s.setName("create").setDescription("Create a job and escrow the customer's funds (staff)")
            .addUserOption(o => o.setName("customer").setDescription("Customer").setRequired(true))
            .addNumberOption(o => o.setName("price").setDescription("Total price in USD").setMinValue(0.01).setMaxValue(1000000).setRequired(true))
            .addStringOption(o => o.setName("description").setDescription("What needs doing").setMaxLength(1000).setRequired(true))
            .addNumberOption(o => o.setName("deposit").setDescription("Deposit the worker must hold, in USD").setMinValue(0).setMaxValue(1000000))
            .addStringOption(o => o.setName("image").setDescription("Optional image URL")))
        .addSubcommand(s => s.setName("complete").setDescription("Mark a claimed job complete and pay the worker (staff)").addIntegerOption(idOpt))
        .addSubcommand(s => s.setName("cancel").setDescription("Cancel a job and refund the customer (staff)").addIntegerOption(idOpt))
        .addSubcommand(s => s.setName("info").setDescription("Show a job").addIntegerOption(idOpt))
        .addSubcommand(s => s.setName("list").setDescription("List recent jobs")
            .addStringOption(o => o.setName("status").setDescription("Filter by status").addChoices(
                { name: "open", value: "open" }, { name: "claimed", value: "claimed" },
                { name: "completed", value: "completed" }, { name: "cancelled", value: "cancelled" }))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === "create") {
            requireSupport(interaction.member);
            const customer = interaction.options.getUser("customer");
            const image = interaction.options.getString("image");
            if (image && !/^https?:\/\//i.test(image)) throw new UserError("Image must be a http(s) URL.");

            const { job, spent } = await jobs.createJob({
                customerId: customer.id,
                priceCents: toCents(interaction.options.getNumber("price")),
                depositCents: toCents(interaction.options.getNumber("deposit") || 0),
                description: interaction.options.getString("description"),
                imageUrl: image,
                channelId: interaction.channelId,
                createdBy: interaction.user.id,
                supportPct: await require("../services/supportroles").cutFor(interaction.member)
            });

            let posted = true, ticketNote = "";
            try {
                const r = await board.postNewJob(interaction.client, job, interaction.channel);
                if (r.ticket?.error) ticketNote = `\n⚠️ Couldn't post the customer's copy in this ticket: ${r.ticket.error}`;
                else if (r.ticket?.ok) ticketNote = "\n📨 Posted in the claim channel and in this ticket.";
            } catch (e) {
                console.error("[jobs] failed to post job board message:", e.message);
                posted = false;
            }
            await applySpendRole(interaction.guild, customer.id, spent);

            return interaction.reply({
                content: `✅ Created job **#${job.id}** (${fmt(job.price_cents)} escrowed from ${customer.username}).` +
                    (posted ? ticketNote : "\n⚠️ Couldn't post it to the claim channel — check the bot's permissions there (and /setchannels)."),
                ephemeral: true
            });
        }

        const id = interaction.options.getInteger("id");

        if (sub === "complete") {
            requireSupport(interaction.member);
            const job = await jobs.completeJob({ jobId: id, actorId: interaction.user.id });
            await refreshBoard(interaction.client, job);
            return interaction.reply({
                content: `✅ Job #${id} completed. <@${job.worker_id}> earned ${fmt(job.worker_cents)}`  +
                    (job.support_cents > 0 ? `; <@${job.created_by}> earned ${fmt(job.support_cents)} (support cut)` : "") +
                    `; house profit ${fmt(job.house_cents)}.`,
                ephemeral: true
            });
        }

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
                ? rows.map(j => `**#${j.id}** ${j.status} — ${fmt(j.price_cents)} — <@${j.customer_id}>${j.worker_id ? ` → <@${j.worker_id}>` : ""}`).join("\n")
                : "No jobs found.";
            return interaction.reply({ content: text, ephemeral: true });
        }
    }
};

const refreshBoard = (client, job) => board.moveBoard(client, job);
module.exports.refreshBoard = refreshBoard;
