const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const chain = require("../services/chain");
const autopay = require("../services/autopay");
const { fmt, UserError } = require("../utils/money");
const { requireSupport } = require("../utils/perms");
const profit = require("../services/profit");

module.exports = {
    data: new SlashCommandBuilder().setName("pot").setDescription("Show the payout wallet balances (staff)"),

    async execute(interaction) {
        requireSupport(interaction.member);
        if (!chain.configured()) throw new UserError("No payout wallet is set up yet. Add `PAYOUT_PRIVATE_KEY` (or `PAYOUT_XPRV`) on Railway.");
        await interaction.deferReply({ ephemeral: true });
        const s = await autopay.settings();

        let heldCents = 0;
        const rows = await Promise.all(Object.entries(chain.ASSETS).map(async ([method, a]) => {
            try {
                const b = await chain.sender(method).balances();
                heldCents += b.tokenCents;
                const gas = Number(b.gasWei) / 1e18;
                const low = b.tokenCents < s.lowCents ? " ⚠️" : "";
                return `\`${a.label.padEnd(16)}:\` **${fmt(b.tokenCents)}**${low}  (${gas.toFixed(4)} ${a.gas} for fees)`;
            } catch (e) {
                return `\`${a.label.padEnd(16)}:\` couldn't read (${String(e.message).slice(0, 60)})`;
            }
        }));

        // What the wallet has to cover, and what is safe to take out.
        const o = await profit.obligations();
        const owed = o.earnings + o.pending + o.customers + o.buffer;
        const safe = heldCents - owed;
        const maths =
            `\`Held (stablecoins):\` ${fmt(heldCents)}\n` +
            `\`Owed to workers   :\` ${fmt(o.earnings + o.pending)}\n` +
            `\`Customer balances :\` ${fmt(o.customers)}\n` +
            `\`Buffer kept       :\` ${fmt(o.buffer)}\n` +
            (safe >= 0 ? `**Safe to withdraw: ${fmt(safe)}**` : `**⚠️ Short by ${fmt(-safe)}**: top up to cover what's owed.`);

        const embed = new EmbedBuilder().setColor(safe >= 0 ? 0x2ecc71 : 0xe67e22).setTitle("Payout wallet")
            .setDescription(`\`Address:\` \`${chain.address()}\`\n\`Auto send:\` ${s.enabled ? "on" : "off"}\n\n${rows.join("\n")}\n\n${maths}`)
            .setFooter({ text: `Top up on the right network only. Low-balance alert at ${fmt(s.lowCents)}.` });
        return interaction.editReply({ embeds: [embed] });
    }
};
