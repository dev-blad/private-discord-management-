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
            .addStringOption(o => o.setName("source").setDescription("How they paid (for your analytics)").addChoices(
                { name: "Crypto", value: "crypto" }, { name: "PayPal", value: "paypal" },
                { name: "GP (gold)", value: "gp" }, { name: "Other", value: "other" }))
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
            const member = self ? interaction.member : await interaction.guild.members.fetch(target.id).catch(() => null);
            const embed = await require("../prefix/w").walletEmbed({ guild: interaction.guild, user: target, member });
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (sub === "history") {
            const rows = await wallets.history(target.id, 15);
            const lines = rows.map(r => {
                const when = Math.floor(r.created_at.getTime() / 1000);
                return `<t:${when}:d> \`${((r.delta_cents > 0 ? "+" : "-") + fmt(Math.abs(r.delta_cents))).padStart(10)}\` ${r.bucket} · ${r.kind}${r.note ? ` (${r.note})` : ""}`;
            });
            const e = new EmbedBuilder().setColor(0x00ae86).setTitle("Wallet History").setDescription(`<@${target.id}>\n\n` + (lines.join("\n") || "No activity yet."))
                .setThumbnail(target.displayAvatarURL({ size: 128 }))
                .setFooter({ text: interaction.guild?.name || " ", iconURL: interaction.guild?.iconURL?.() || undefined });
            return interaction.reply({ embeds: [e], ephemeral: true });
        }

        const cents = toCents(interaction.options.getNumber("amount"));
        const note = interaction.options.getString("note");
        const fn = sub === "add" ? wallets.deposit : wallets.charge;
        const r = await fn({ discordId: target.id, cents, actorId: interaction.user.id, note, ...(sub === "add" ? { source: interaction.options.getString("source") } : {}) });
        return interaction.reply({
            content: `✅ ${sub === "add" ? "Added" : "Removed"} ${fmt(cents)} ${sub === "add" ? "to" : "from"} **${target.username}**. New balance: ${fmt(r.balance)}`,
            ephemeral: true
        });
    }
};
