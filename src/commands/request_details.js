const { SlashCommandBuilder } = require("discord.js");
const svc = require("../services/reqdetails");
const { requireSupport } = require("../utils/perms");
const { UserError } = require("../utils/money");
const { requestMessage } = require("../utils/reqdetails");
const { query } = require("../db");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("request_details")
        .setDescription("Ask the customer for their account login, privately for the worker (staff)")
        .addUserOption(o => o.setName("user").setDescription("Customer (default: the customer on this ticket's order)")),

    async execute(interaction) {
        requireSupport(interaction.member);
        let customerId = interaction.options.getUser("user")?.id;
        if (!customerId) {
            const { rows } = await query("SELECT customer_id FROM jobs WHERE channel_id=$1 AND status IN ('open','claimed') ORDER BY id DESC LIMIT 1", [interaction.channelId]);
            customerId = rows[0]?.customer_id;
        }
        if (!customerId) throw new UserError("Pick the customer with `user:` (this ticket has no active order).");
        require("../utils/secret").encrypt("x"); // fails early with a clear message if ACCOUNT_ENC_KEY is not set

        const r = await svc.create({ channelId: interaction.channelId, requestedBy: interaction.user.id, customerId });
        const msg = await interaction.channel.send(requestMessage(r, { guild: interaction.guild, requesterName: interaction.member?.displayName }));
        await svc.setMessage(r.id, msg.id);
        return interaction.reply({ content: "✅ Request sent", ephemeral: true });
    }
};
