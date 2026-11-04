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
        const field = (id, label, required, style = TextInputStyle.Short, max = 200) =>
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label)
                .setStyle(style).setRequired(required).setMaxLength(max));
        return interaction.showModal(new ModalBuilder().setCustomId(`acct_details:${a.id}`)
            .setTitle(`Delivery details for ${a.id}`).addComponents(
                field("login", "Login Email / Username", true),
                field("password", "Password", true),
                field("recovery", "Recovery Details (blank = N/A)", false),
                field("pin", "Bank Pin (blank = N/A)", false, TextInputStyle.Short, 20),
                field("notes", "Notes (blank = none)", false, TextInputStyle.Paragraph, 500)));
    }
};
