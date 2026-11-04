const { SlashCommandBuilder } = require("discord.js");
const accounts = require("../services/accountsales");
const { requireSupport } = require("../utils/perms");
const { refreshListing } = require("../utils/accountCard");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("delete_account")
        .setDescription("Remove an account listing (staff)")
        .addStringOption(o => o.setName("id").setDescription("Account ID").setRequired(true)),

    async execute(interaction) {
        requireSupport(interaction.member);
        const a = await accounts.remove(interaction.options.getString("id"));
        await refreshListing(interaction.client, a);
        return interaction.reply({ content: `🗑️ Removed **${a.id}** (${a.title}). Past sales stay in the records.`, ephemeral: true });
    }
};
