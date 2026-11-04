const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const jobs = require("../services/jobs");
const board = require("../utils/board");
const { fmt, UserError } = require("../utils/money");
const { requireSupport } = require("../utils/perms");
const { query } = require("../db");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("cancel_order")
        .setDescription("Cancel an order and refund the customer (staff)")
        .addIntegerOption(o => o.setName("id").setDescription("Order number (only needed if this ticket has more than one)").setMinValue(1)),

    async execute(interaction) {
        requireSupport(interaction.member);
        let id = interaction.options.getInteger("id");
        if (!id) {
            const { rows } = await query("SELECT id FROM jobs WHERE channel_id=$1 AND status IN ('open','claimed') ORDER BY id DESC", [interaction.channelId]);
            if (!rows.length) throw new UserError("There's no active order in this channel. Use the order number: `/cancel_order id:`.");
            if (rows.length > 1) throw new UserError(`This ticket has ${rows.length} active orders (${rows.map(r => "#" + r.id).join(", ")}). Pick one with \`id:\`.`);
            id = rows[0].id;
        }

        await interaction.deferReply({ ephemeral: true });
        const job = await jobs.cancelJob({ jobId: id, actorId: interaction.user.id });
        await board.moveBoard(interaction.client, job);

        const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle("❌ Order Cancelled")
            .setDescription(
                `\`Order ID  :\` #${job.id}\n` +
                `\`Customer  :\` <@${job.customer_id}>\n` +
                `\`Refunded  :\` ${fmt(job.price_cents)}`)
            .setFooter({ text: interaction.guild?.name || "Orders", iconURL: interaction.guild?.iconURL?.() || undefined })
            .setTimestamp();
        await interaction.channel.send({ content: `<@${job.customer_id}>`, embeds: [embed] });
        await interaction.editReply(`✅ Order #${id} cancelled and ${fmt(job.price_cents)} refunded to <@${job.customer_id}>.`);
    }
};
