const { SlashCommandBuilder } = require("discord.js");
const payouts = require("../services/payouts");
const autopay = require("../services/autopay");
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
        await interaction.deferReply({ ephemeral: true });
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

        const auto = await autopay.maybeAuto(payout);
        if (auto.payout) await autopay.announce(interaction.client, auto);

        const amount = fmt(payout.amount_cents);
        let msg;
        if (auto.state === "paid") msg = `💸 Sent! **${amount}** is on its way to your wallet.\nhttps://basescan.org/tx/${auto.payout.paid_ref}`;
        else if (auto.state === "unconfirmed") msg = `📤 Payout **#${payout.id}** (${amount}) was sent and is waiting for confirmation. You'll get a DM when it lands.`;
        else if (auto.state === "review") msg = `✅ Payout **#${payout.id}** requested for ${amount} (${payout.method}). Staff will review it shortly.`;
        else msg = `✅ Payout **#${payout.id}** requested for ${amount} (${payout.method}). It's queued and will be sent shortly.`;
        return interaction.editReply({ content: msg + (posted ? "" : "\n⚠️ Staff couldn't be notified automatically — please ping support.") });
    }
};
