const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const chain = require("../services/chain");
const autopay = require("../services/autopay");
const { fmt, UserError } = require("../utils/money");
const { requireSupport } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder().setName("pot").setDescription("Show the payout wallet balance (staff)"),

    async execute(interaction) {
        requireSupport(interaction.member);
        if (!chain.configured()) throw new UserError("No payout wallet is set up yet. Add `PAYOUT_PRIVATE_KEY` on Railway.");
        await interaction.deferReply({ ephemeral: true });
        let bal;
        try { bal = await chain.sender().balances(); }
        catch (e) { throw new UserError(`Couldn't reach the Base network: ${e.message}`.slice(0, 300)); }
        const s = await autopay.settings();
        const eth = Number(bal.ethWei) / 1e18;
        const embed = new EmbedBuilder().setColor(bal.usdcCents < s.lowCents ? 0xe67e22 : 0x2ecc71)
            .setTitle("Payout wallet")
            .setDescription(
                `\`Address   :\` \`${chain.address()}\`\n` +
                `\`USDC      :\` **${fmt(bal.usdcCents)}**\n` +
                `\`ETH (fees):\` ${eth.toFixed(5)}\n` +
                `\`Auto send :\` ${s.enabled ? "on" : "off"}`)
            .setFooter({ text: `Top up on Base only. Low-balance alert at ${fmt(s.lowCents)}.` });
        return interaction.editReply({ embeds: [embed] });
    }
};
