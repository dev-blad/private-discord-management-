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
                { name: "USDT (Ethereum) - automatic", value: "USDT-ERC20" }, { name: "USDC (Ethereum) - automatic", value: "USDC-ERC20" },
                { name: "USDC (Base) - automatic", value: "USDC-BASE" }, { name: "USDT (Polygon) - automatic", value: "USDT-POLYGON" },
                { name: "USDT (Arbitrum) - automatic", value: "USDT-ARBITRUM" }, { name: "USDT (TRC20) - manual", value: "USDT-TRC20" }, { name: "Litecoin - manual", value: "LTC" },
                { name: "Bitcoin - manual", value: "BTC" }))
            .addStringOption(o => o.setName("address").setDescription("Your wallet address").setRequired(true).setMinLength(10).setMaxLength(120)))
        .addSubcommand(s => s.setName("view").setDescription("Show your saved payout addresses"))
        .addSubcommand(s => s.setName("remove").setDescription("Delete one of your saved addresses")
            .addStringOption(o => o.setName("method").setDescription("Which one").setRequired(true).setAutocomplete(true)))
        .addSubcommand(s => s.setName("pending").setDescription("List payouts awaiting action (staff)")),

    async autocomplete(interaction) {
        const list = await wallets.listPayoutAddresses(interaction.user.id);
        return interaction.respond(list.map(a => ({ name: `${a.method} · ${a.address.slice(0, 6)}…${a.address.slice(-4)}`.slice(0, 100), value: a.method })));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === "address") {
            requireBooster(interaction.member);
            const address = interaction.options.getString("address").trim();
            if (/\s/.test(address)) throw new UserError("Addresses can't contain spaces.");
            const method = interaction.options.getString("method");
            if (require("../services/chain").supports(method)) {
                const chain = require("../services/chain");
                if (!chain.isValidAddress(address)) throw new UserError("That isn't a valid 0x... wallet address. It should be 42 characters starting with 0x.");
                if (chain.address() && address.toLowerCase() === chain.address().toLowerCase()) throw new UserError("That's the payout wallet itself. Use your own wallet address.");
            }
            await wallets.setPayoutAddress(interaction.user.id, method, address);
            return interaction.reply({
                content: `✅ Saved: **${method}** \`${address}\`\nDouble-check it — payouts go exactly here.` + (require("../services/chain").supports(method) ? `\nMake sure your wallet or exchange accepts **${require("../services/chain").asset(method).label}** deposits. Sending to the wrong network can't be reversed.` : ""), ephemeral: true });
        }
        if (sub === "view") {
            const list = await wallets.listPayoutAddresses(interaction.user.id);
            return interaction.reply({
                content: list.length
                    ? "**Your payout addresses** (newest is used unless you pick one in `/claimearnings`)\n" + list.map(a => `• **${a.method}** \`${a.address}\``).join("\n")
                    : "No payout address set. Use `/payout address`.",
                ephemeral: true });
        }
        if (sub === "remove") {
            requireBooster(interaction.member);
            const method = interaction.options.getString("method");
            await wallets.removePayoutAddress(interaction.user.id, method);
            return interaction.reply({ content: `🗑️ Removed your **${method}** address.`, ephemeral: true });
        }
        requireSupport(interaction.member);
        const list = await payouts.listPending();
        const text = list.length
            ? list.map(p => `**#${p.id}** \`${p.status.padEnd(9)}\` ${fmt(p.amount_cents)} ${p.method} · <@${p.discord_id}>`).join("\n")
            : "Nothing pending. 🎉";
        return interaction.reply({ embeds: [new (require("discord.js").EmbedBuilder)().setColor(0x00ae86).setTitle("Payouts").setDescription(text)
                .setFooter({ text: interaction.guild?.name || " ", iconURL: interaction.guild?.iconURL?.() || undefined })], ephemeral: true });
    }
};
