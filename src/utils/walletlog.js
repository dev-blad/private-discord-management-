const { EmbedBuilder } = require("discord.js");
const config = require("../services/config");

/** Post every manual wallet change to the staff log channel (if one is set), so none of them are invisible. */
async function walletLog(interaction, { action, targetId, text }) {
    try {
        const id = await config.get("wallet_log_channel_id");
        if (!id) return;
        const ch = await interaction.client.channels.fetch(id);
        await ch.send({
            allowedMentions: { parse: [] },
            embeds: [new EmbedBuilder().setColor(0xf1c40f).setAuthor({ name: `Wallet ${action}` })
                .setDescription(`\`By     :\` <@${interaction.user.id}>\n\`For    :\` <@${targetId}>\n${text}`).setTimestamp()]
        });
    } catch (e) { console.error("[walletlog] couldn't post:", e.message); }
}
module.exports = { walletLog };
