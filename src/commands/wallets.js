const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const wallets = require("../services/wallets");
const { toCents, fmt } = require("../utils/money");
const { isSupport, requireSupport } = require("../utils/perms");

const amountOpt = o => o.setName("amount").setDescription("Amount in USD, e.g. 25 or 12.50").setMinValue(0.01).setMaxValue(1000000).setRequired(true);

module.exports = {
    data: new SlashCommandBuilder()
        .setName("wallet")
        .setDescription("Wallet commands (USD)")
        .addSubcommand(s => s.setName("check").setDescription("Check a wallet")
            .addUserOption(o => o.setName("user").setDescription("User (staff only; defaults to you)")))
        .addSubcommand(s => s.setName("add").setDescription("Add funds to a customer's balance (staff)")
            .addUserOption(o => o.setName("user").setDescription("Customer").setRequired(true))
            .addNumberOption(amountOpt)
            .addStringOption(o => o.setName("note").setDescription("Reason / payment reference").setMaxLength(200)))
        .addSubcommand(s => s.setName("remove").setDescription("Remove funds from a customer's balance (staff)")
            .addUserOption(o => o.setName("user").setDescription("Customer").setRequired(true))
            .addNumberOption(amountOpt)
            .addStringOption(o => o.setName("note").setDescription("Reason").setMaxLength(200)))
        .addSubcommand(s => s.setName("history").setDescription("Recent wallet activity")
            .addUserOption(o => o.setName("user").setDescription("User (staff only; defaults to you)"))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const target = interaction.options.getUser("user") || interaction.user;
        const self = target.id === interaction.user.id;

        if (sub === "check" || sub === "history") {
            if (!self) requireSupport(interaction.member);
        } else {
            requireSupport(interaction.member);
        }

        if (sub === "check") {
            const w = await wallets.getWallet(target.id);
            const e = new EmbedBuilder().setTitle(`Wallet — ${target.username}`).setColor(0x2ecc71).addFields(
                { name: "Balance", value: fmt(w.balance), inline: true },
                { name: "Earnings", value: fmt(w.earnings), inline: true },
                { name: "Lifetime spent", value: fmt(w.spent), inline: true });
            return interaction.reply({ embeds: [e], ephemeral: true });
        }

        if (sub === "history") {
            const rows = await wallets.history(target.id, 15);
            const text = rows.length
                ? rows.map(r => `\`${r.created_at.toISOString().slice(0, 16).replace("T", " ")}\` ${r.delta_cents > 0 ? "+" : ""}${fmt(r.delta_cents)} ${r.bucket} — ${r.kind}${r.note ? ` (${r.note})` : ""}`).join("\n")
                : "No activity yet.";
            return interaction.reply({ content: `**History for ${target.username}**\n${text}`, ephemeral: true });
        }

        const cents = toCents(interaction.options.getNumber("amount"));
        const note = interaction.options.getString("note");
        const fn = sub === "add" ? wallets.deposit : wallets.charge;
        const r = await fn({ discordId: target.id, cents, actorId: interaction.user.id, note });
        return interaction.reply({
            content: `✅ ${sub === "add" ? "Added" : "Removed"} ${fmt(cents)} ${sub === "add" ? "to" : "from"} **${target.username}**. New balance: ${fmt(r.balance)}`,
            ephemeral: true
        });
    }
};
