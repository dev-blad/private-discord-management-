const { SlashCommandBuilder, ChannelType } = require("discord.js");
const config = require("../services/config");
const { requireAdmin } = require("../utils/perms");

const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const OPTS = [
    ["claim", "claim_channel_id", "New jobs appear here with a Claim button"],
    ["claimed", "claimed_channel_id", "Jobs move here when a worker claims them"],
    ["completed", "completed_channel_id", "Jobs move here when completed"],
    ["cancelled", "cancelled_channel_id", "Jobs move here when cancelled"],
    ["payouts", "payout_channel_id", "Payout requests for approval"],
    ["vouches", "vouch_channel_id", "Customer reviews are posted here"]
];

module.exports = {
    data: OPTS.reduce((b, [name, , desc]) =>
        b.addChannelOption(o => o.setName(name).setDescription(desc).addChannelTypes(...TEXT)),
        new SlashCommandBuilder().setName("setchannels").setDescription("Choose the channels jobs move through (admin)")),

    async execute(interaction) {
        requireAdmin(interaction.member);
        const lines = [];
        for (const [name, key] of OPTS) {
            const ch = interaction.options.getChannel(name);
            if (ch) await config.set(key, ch.id);
            const id = ch?.id || await config.get(key);
            lines.push(`• **${name}**: ${id ? `<#${id}>` : "not set"}`);
        }
        return interaction.reply({ content: `✅ Job channels:\n${lines.join("\n")}`, ephemeral: true, allowedMentions: { parse: [] } });
    }
};
