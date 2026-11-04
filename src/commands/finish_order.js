const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const jobs = require("../services/jobs");
const board = require("../utils/board");
const { fmt, UserError } = require("../utils/money");
const { requireSupport } = require("../utils/perms");
const { feedbackRow } = require("../utils/feedback");
const { query } = require("../db");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("finish_order")
        .setDescription("Complete the claimed order in this ticket and pay the worker (staff)")
        .addIntegerOption(o => o.setName("id").setDescription("Order number (only needed if the ticket has more than one)").setMinValue(1)),

    async execute(interaction) {
        requireSupport(interaction.member);
        let id = interaction.options.getInteger("id");
        if (!id) {
            const { rows } = await query("SELECT id FROM jobs WHERE channel_id=$1 AND status='claimed' ORDER BY id DESC", [interaction.channelId]);
            if (!rows.length) throw new UserError("There's no claimed order in this channel. Use the order number: `/finish_order id:`.");
            if (rows.length > 1) throw new UserError(`This ticket has ${rows.length} claimed orders (${rows.map(r => "#" + r.id).join(", ")}). Pick one with \`id:\`.`);
            id = rows[0].id;
        }

        await interaction.deferReply({ ephemeral: true });
        const job = await jobs.completeJob({ jobId: id, actorId: interaction.user.id });
        await board.moveBoard(interaction.client, job);

        const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ Job Completed")
            .setDescription(
                `\`Order ID  :\` #${job.id}\n` +
                `\`Customer  :\` <@${job.customer_id}>\n` +
                `\`Worker    :\` <@${job.worker_id}>\n\n` +
                "Thank you for your business! Please leave feedback below.")
            .setFooter({ text: interaction.guild?.name || "Orders", iconURL: interaction.guild?.iconURL?.() || undefined })
            .setTimestamp();
        await interaction.channel.send({ content: `<@${job.customer_id}>`, embeds: [embed], components: [feedbackRow(job.id)] });

        await interaction.editReply(
            `✅ Order #${id} completed. <@${job.worker_id}> earned ${fmt(job.worker_cents)}` +
            (job.support_cents > 0 ? `; <@${job.created_by}> earned ${fmt(job.support_cents)} (support cut)` : "") +
            `; house profit ${fmt(job.house_cents)}.`);
    }
};
