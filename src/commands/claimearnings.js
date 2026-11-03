const { SlashCommandBuilder } = require("discord.js");
const payouts = require("../services/payouts");
const config = require("../services/config");
const { toCents, fmt } = require("../utils/money");
const { requireBooster } = require("../utils/perms");
const { payoutEmbed, payoutRow } = require("../utils/embeds");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("claimearnings")
        .setDescription("Request a payout of your earnings")
        .addNumberOption(o => o.setName("amount").setDescription("USD to withdraw (leave blank for everything)").setMinValue(0.01).setMaxValue(1000000)),

    async execute(interaction) {
        requireBooster(interaction.member);
        const raw = interaction.options.getNumber("amount");
        const payout = await payouts.requestPayout({
            discordId: interaction.user.id,
            cents: raw == null ? null : toCents(raw)
        });

        let posted = true;
        try {
            const chId = (await config.get("payout_channel_id")) || process.env.PAYOUT_CHANNEL_ID;
            if (!chId) throw new Error("payout_channel_id not configured");
            const ch = await interaction.client.channels.fetch(chId);
            const msg = await ch.send({ embeds: [payoutEmbed(payout)], components: payoutRow(payout) });
            await payouts.setMessage(payout.id, ch.id, msg.id);
        } catch (e) {
            console.error("[payout] couldn't notify staff:", e.message);
            posted = false;
        }

        return interaction.reply({
            content: `✅ Payout **#${payout.id}** requested for ${fmt(payout.amount_cents)} (${payout.method}). Staff will review it shortly.` +
                (posted ? "" : "\n⚠️ Staff couldn't be notified automatically — please ping support."),
            ephemeral: true
        });
    }
};
