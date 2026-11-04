const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const chain = require("../services/chain");
const autopay = require("../services/autopay");
const { fmt, UserError } = require("../utils/money");
const { requireSupport } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder().setName("pot").setDescription("Show the payout wallet balances (staff)"),

    async execute(interaction) {
        requireSupport(interaction.member);
        if (!chain.configured()) throw new UserError("No payout wallet is set up yet. Add `PAYOUT_PRIVATE_KEY` on Railway.");
        await interaction.deferReply({ ephemeral: true });
        const s = await autopay.settings();

        const rows = await Promise.all(Object.entries(chain.ASSETS).map(async ([method, a]) => {
            try {
                const b = await chain.sender(method).balances();
                const gas = Number(b.gasWei) / 1e18;
                const low = b.tokenCents < s.lowCents ? " ⚠️" : "";
                return `\`${a.label.padEnd(16)}:\` **${fmt(b.tokenCents)}**${low}  (${gas.toFixed(4)} ${a.gas} for fees)`;
            } catch (e) {
                return `\`${a.label.padEnd(16)}:\` couldn't read (${String(e.message).slice(0, 60)})`;
            }
        }));

        const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("Payout wallet")
            .setDescription(`\`Address:\` \`${chain.address()}\`\n\`Auto send:\` ${s.enabled ? "on" : "off"}\n\n${rows.join("\n")}`)
            .setFooter({ text: `Top up on the right network only. Low-balance alert at ${fmt(s.lowCents)}.` });
        return interaction.editReply({ embeds: [embed] });
    }
};
