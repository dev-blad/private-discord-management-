const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
const locations = require("../services/locations");
const { requireSupport } = require("../utils/perms");
const { UserError } = require("../utils/money");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("send_location")
        .setDescription("Send a mule's meeting spot to this ticket so the customer can pay in GP (staff)"),

    async execute(interaction) {
        requireSupport(interaction.member);
        const list = await locations.list();
        if (!list.length) throw new UserError("No mule locations saved yet. Add one with `/add_location`.");
        const menu = new StringSelectMenuBuilder().setCustomId(`loc_send:${interaction.user.id}`)
            .setPlaceholder("Select an RSN to view details")
            .addOptions(list.map(l => ({ label: l.rsn.slice(0, 100), description: `World: ${l.world} · ${l.location}`.slice(0, 100), value: String(l.id) })));
        return interaction.reply({
            content: "Select an RSN to view location details:",
            components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true
        });
    },

    /** The worker picked an RSN: post the location card publicly in the ticket. */
    async onSelect(interaction) {
        const ownerId = interaction.customId.split(":")[1];
        if (interaction.user.id !== ownerId) throw new UserError("This menu isn't yours.");
        const { EmbedBuilder, AttachmentBuilder } = require("discord.js");
        const l = await locations.get(Number(interaction.values[0]));
        const ext = (l.image_type || "image/png").split("/")[1].split(";")[0] || "png";
        const lines = [["RSN", l.rsn], ["World", l.world], ["Location", l.location]]
            .map(([k, v]) => `🔷 \`${k.padEnd(9)}:\` ${v}`).join("\n");
        const embed = new EmbedBuilder().setColor(0x3498db).setTitle("📍 Location Details")
            .setDescription(`<@${ownerId}> has sent in-game location.\n\nPlease make your way to the location highlighted on the screenshot below to make your payment, post your RSN below and tag us when you are at the location.\n\n${lines}`)
            .setFooter({ text: interaction.guild?.name || " ", iconURL: interaction.guild?.iconURL?.() || undefined });
        if (interaction.guild?.iconURL) embed.setThumbnail(interaction.guild.iconURL());
        const files = [];
        if (l.image) { embed.setImage(`attachment://location.${ext}`); files.push(new AttachmentBuilder(l.image, { name: `location.${ext}` })); }
        await interaction.channel.send({ embeds: [embed], files });
        return interaction.update({ content: `✅ Sent **${l.rsn}**'s location to the ticket.`, components: [] });
    }
};
