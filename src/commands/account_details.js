const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const accounts = require("../services/accountsales");
const { requireSupport } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("account_details")
        .setDescription("Set the login details that /send_account will DM to the buyer (staff)")
        .addStringOption(o => o.setName("id").setDescription("Account ID").setRequired(true)),

    async execute(interaction) {
        requireSupport(interaction.member);
        const a = await accounts.get(interaction.options.getString("id"));
        const input = new TextInputBuilder().setCustomId("details").setLabel(`Delivery details for ${a.id}`)
            .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500)
            .setPlaceholder("Username / password / bank PIN / recovery steps. Sent to the buyer only.");
        return interaction.showModal(new ModalBuilder().setCustomId(`acct_details:${a.id}`)
            .setTitle("Account delivery details").addComponents(new ActionRowBuilder().addComponents(input)));
    }
};
