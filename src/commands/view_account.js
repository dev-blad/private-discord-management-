const { SlashCommandBuilder } = require("discord.js");
const accounts = require("../services/accountsales");
const { requireSupport } = require("../utils/perms");
const { accountEmbed } = require("../utils/accountCard");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("view_account")
        .setDescription("Show an account listing (staff)")
        .addStringOption(o => o.setName("id").setDescription("Account ID").setRequired(true))
        .addStringOption(o => o.setName("visibility").setDescription("Who sees it (default: just you)").addChoices(
            { name: "Public (show in this channel)", value: "public" }, { name: "Private (only me)", value: "private" })),

    async execute(interaction) {
        requireSupport(interaction.member);
        const a = await accounts.get(interaction.options.getString("id"));
        const isPublic = interaction.options.getString("visibility") === "public";
        return interaction.reply({ embeds: [await accountEmbed(a, interaction.guild)], ephemeral: !isPublic });
    }
};
