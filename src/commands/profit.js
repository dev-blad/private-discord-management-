const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const profit = require("../services/profit");
const config = require("../services/config");
const { toCents, fmt } = require("../utils/money");
const { requireAdmin } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("profit")
        .setDescription("Partner profit share (admin)")
        .addSubcommand(s => s.setName("status").setDescription("Profit earned, taken and available for each partner"))
        .addSubcommand(s => s.setName("withdraw").setDescription("Record profit a partner has taken out")
            .addUserOption(o => o.setName("partner").setDescription("Partner").setRequired(true))
            .addNumberOption(o => o.setName("amount").setDescription("USD taken").setMinValue(0.01).setRequired(true))
            .addStringOption(o => o.setName("note").setDescription("Reference / tx hash").setMaxLength(200)))
        .addSubcommand(s => s.setName("partners").setDescription("Set the partners who share the profit")
            .addUserOption(o => o.setName("first").setDescription("First partner").setRequired(true))
            .addUserOption(o => o.setName("second").setDescription("Second partner")))
        .addSubcommand(s => s.setName("buffer").setDescription("Share of each job's price kept in the wallet as a cushion")
            .addNumberOption(o => o.setName("percent").setDescription("e.g. 1").setMinValue(0).setMaxValue(20).setRequired(true))),

    async execute(interaction) {
        requireAdmin(interaction.member);
        const sub = interaction.options.getSubcommand();
        const quiet = { ephemeral: true, allowedMentions: { parse: [] } };

        if (sub === "partners") {
            const ids = ["first", "second"].map(n => interaction.options.getUser(n)?.id).filter(Boolean);
            await config.set("partner_ids", [...new Set(ids)].join(","));
            return interaction.reply({ content: `✅ Profit is shared between ${ids.map(i => `<@${i}>`).join(" and ")}.`, ...quiet });
        }
        if (sub === "buffer") {
            const pct = interaction.options.getNumber("percent", true);
            await config.set("house_buffer_pct", String(pct));
            return interaction.reply({ content: `✅ ${pct}% of each completed job's price stays in the wallet as a buffer.`, ...quiet });
        }
        if (sub === "withdraw") {
            const partner = interaction.options.getUser("partner", true);
            await profit.withdraw({ partnerId: partner.id, cents: toCents(interaction.options.getNumber("amount", true)),
                actorId: interaction.user.id, note: interaction.options.getString("note") });
            return interaction.reply({ content: `✅ Recorded ${fmt(toCents(interaction.options.getNumber("amount", true)))} taken by <@${partner.id}>.`, ...quiet });
        }

        const s = await profit.summary();
        if (!s.partners.length) return interaction.reply({ content: "Set the partners first with `/profit partners`.", ...quiet });
        const e = new EmbedBuilder().setColor(0x9b59b6).setTitle("💼 Profit share")
            .setDescription(
                `\`Revenue    :\` ${fmt(s.revenueCents)}\n` +
                `\`House take :\` ${fmt(s.houseCents)}\n` +
                `\`Buffer ${String(s.bufferPct).padEnd(3)}%:\` ${fmt(s.buffer)} (stays in the wallet)\n` +
                `\`Partner pool:\` ${fmt(s.pool)}\n\n` +
                s.partners.map(p => `<@${p.id}>\n\`Earned    :\` ${fmt(p.accrued)}\n\`Taken     :\` ${fmt(p.taken)}\n\`Available :\` **${fmt(p.available)}**`).join("\n\n"));
        return interaction.reply({ embeds: [e], ...quiet });
    }
};
