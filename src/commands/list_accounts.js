const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const accounts = require("../services/accountsales");
const { fmt } = require("../utils/money");
const { requireSupport } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("list_accounts")
        .setDescription("Short list of accounts for sale (staff)")
        .addBooleanOption(o => o.setName("public").setDescription("Show it in this channel")),

    async execute(interaction) {
        requireSupport(interaction.member);
        const rows = await accounts.list();
        const text = rows.length
            ? rows.map(a => `\`${a.id.padEnd(6)}\` **${a.title}** · ${fmt(Number(a.price_cents))} · ${a.stock} in stock\n${a.description.slice(0, 90)}${a.description.length > 90 ? "…" : ""}`).join("\n\n")
            : "No accounts for sale.";
        const e = new EmbedBuilder().setColor(0x5865f2).setTitle("🧾 Accounts for sale").setDescription(text)
            .setFooter({ text: interaction.guild?.name || " ", iconURL: interaction.guild?.iconURL?.() || undefined });
        return interaction.reply({ embeds: [e], ephemeral: !interaction.options.getBoolean("public") });
    }
};
