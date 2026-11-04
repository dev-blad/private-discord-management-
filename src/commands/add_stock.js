const { SlashCommandBuilder } = require("discord.js");
const accounts = require("../services/accountsales");
const { requireSupport } = require("../utils/perms");
const { refreshListing } = require("../utils/accountCard");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("add_stock")
        .setDescription("Add more copies of an account to its listing (staff)")
        .addStringOption(o => o.setName("id").setDescription("Account ID").setRequired(true))
        .addIntegerOption(o => o.setName("amount").setDescription("How many to add").setMinValue(1).setMaxValue(100).setRequired(true)),

    async execute(interaction) {
        requireSupport(interaction.member);
        const a = await accounts.addStock(interaction.options.getString("id"), interaction.options.getInteger("amount"));
        await refreshListing(interaction.client, a);
        return interaction.reply({ content: `✅ **${a.id}** now has ${a.stock} in stock.`, ephemeral: true });
    }
};
