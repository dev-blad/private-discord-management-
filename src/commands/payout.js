const { SlashCommandBuilder } = require("discord.js");
const wallets = require("../services/wallets");
const payouts = require("../services/payouts");
const { fmt, UserError } = require("../utils/money");
const { requireBooster, requireSupport } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("payout")
        .setDescription("Payout settings")
        .addSubcommand(s => s.setName("address").setDescription("Set where your earnings are sent")
            .addStringOption(o => o.setName("method").setDescription("Coin / network").setRequired(true).addChoices(
                { name: "USDT (TRC20)", value: "USDT-TRC20" }, { name: "USDT (ERC20)", value: "USDT-ERC20" },
                { name: "USDC (ERC20)", value: "USDC-ERC20" }, { name: "Litecoin", value: "LTC" },
                { name: "Bitcoin", value: "BTC" }))
            .addStringOption(o => o.setName("address").setDescription("Your wallet address").setRequired(true).setMinLength(10).setMaxLength(120)))
        .addSubcommand(s => s.setName("view").setDescription("Show your saved payout address"))
        .addSubcommand(s => s.setName("pending").setDescription("List payouts awaiting action (staff)")),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === "address") {
            requireBooster(interaction.member);
            const address = interaction.options.getString("address").trim();
            if (/\s/.test(address)) throw new UserError("Addresses can't contain spaces.");
            const method = interaction.options.getString("method");
            await wallets.setPayoutAddress(interaction.user.id, method, address);
            return interaction.reply({
                content: `✅ Saved: **${method}** \`${address}\`\nDouble-check it — payouts go exactly here.`, ephemeral: true });
        }
        if (sub === "view") {
            const p = await wallets.getProfile(interaction.user.id);
            return interaction.reply({
                content: p?.payout_address ? `**${p.payout_method}** \`${p.payout_address}\`` : "No payout address set. Use `/payout address`.",
                ephemeral: true });
        }
        requireSupport(interaction.member);
        const list = await payouts.listPending();
        const text = list.length
            ? list.map(p => `**#${p.id}** ${p.status} — ${fmt(p.amount_cents)} ${p.method} — <@${p.discord_id}>`).join("\n")
            : "Nothing pending. 🎉";
        return interaction.reply({ content: text, ephemeral: true });
    }
};
