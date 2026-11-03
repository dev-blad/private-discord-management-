const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const pricing = require("../services/pricing");
const wallets = require("../services/wallets");
const { toCents, fmt, UserError } = require("../utils/money");
const { requireSupport } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("pricing")
        .setDescription("Show pricing with your discount")
        .addSubcommand(s => s.setName("show").setDescription("Show pricing options"))
        .addSubcommand(s => s.setName("set").setDescription("Add or update a price (staff)")
            .addStringOption(o => o.setName("name").setDescription("Service name").setRequired(true).setMaxLength(100))
            .addNumberOption(o => o.setName("price").setDescription("Price in USD").setMinValue(0).setMaxValue(1000000).setRequired(true)))
        .addSubcommand(s => s.setName("remove").setDescription("Remove a price (staff)")
            .addStringOption(o => o.setName("name").setDescription("Service name").setRequired(true))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === "set") {
            requireSupport(interaction.member);
            const name = interaction.options.getString("name");
            const cents = toCents(interaction.options.getNumber("price"));
            await pricing.set(name, cents);
            return interaction.reply({ content: `✅ ${name}: ${fmt(cents)}`, ephemeral: true });
        }
        if (sub === "remove") {
            requireSupport(interaction.member);
            const name = interaction.options.getString("name");
            if (!(await pricing.remove(name))) throw new UserError(`No price named "${name}".`);
            return interaction.reply({ content: `✅ Removed ${name}.`, ephemeral: true });
        }

        const [options, wallet] = await Promise.all([pricing.list(), wallets.getWallet(interaction.user.id)]);
        if (!options.length) return interaction.reply({ content: "No pricing set up yet.", ephemeral: true });
        const tier = await pricing.discountFor(wallet.spent);
        const pct = tier?.percent || 0;

        const embed = new EmbedBuilder().setTitle("📊 Pricing").setColor(0x3498db)
            .setDescription(pct > 0 ? `💸 You qualify for a **${pct}% discount**` : "No discount applied yet")
            .addFields(options.map(o => {
                const disc = Math.floor(o.price_cents * (100 - pct) / 100);
                return { name: o.name, value: pct > 0 ? `${fmt(o.price_cents)} → **${fmt(disc)}**` : fmt(o.price_cents), inline: true };
            }));
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
