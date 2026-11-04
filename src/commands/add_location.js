const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const locations = require("../services/locations");
const { requireBooster } = require("../utils/perms");
const { UserError } = require("../utils/money");
const { rows } = require("../utils/box");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("add_location")
        .setDescription("Save an account's in-game meeting spot (workers)")
        .addStringOption(o => o.setName("rsn").setDescription("The account's RSN").setMaxLength(12).setRequired(true))
        .addStringOption(o => o.setName("world").setDescription("World number, e.g. 308").setMaxLength(3).setRequired(true))
        .addStringOption(o => o.setName("location").setDescription("Where, e.g. GE").setMaxLength(100).setRequired(true))
        .addAttachmentOption(o => o.setName("image").setDescription("Screenshot with the spot highlighted").setRequired(true)),

    async execute(interaction) {
        requireBooster(interaction.member);
        const world = interaction.options.getString("world").trim();
        if (!/^\d{1,3}$/.test(world)) throw new UserError("World must be a number, e.g. `308`.");
        const att = interaction.options.getAttachment("image");
        if (!att.contentType?.startsWith("image/")) throw new UserError("The attachment must be an image.");
        if (att.size > 8 * 1024 * 1024) throw new UserError("That image is over 8MB. Use a smaller screenshot.");

        await interaction.deferReply({ ephemeral: true });
        // Discord's image links expire, so keep our own copy.
        const res = await fetch(att.url);
        if (!res.ok) throw new UserError("I couldn't download that image. Try attaching it again.");
        const image = Buffer.from(await res.arrayBuffer());

        const rsn = interaction.options.getString("rsn").trim();
        const loc = interaction.options.getString("location").trim();
        await locations.save({ discordId: interaction.user.id, rsn, world, location: loc, image, imageType: att.contentType });

        const ext = att.contentType.split("/")[1].split(";")[0] || "png";
        const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ Location Added")
            .setDescription(rows([["RSN", rsn], ["World", world], ["Location", loc]], 9))
            .setImage(`attachment://location.${ext}`)
            .setFooter({ text: interaction.guild?.name || " ", iconURL: interaction.guild?.iconURL?.() || undefined });
        return interaction.editReply({ embeds: [embed], files: [new AttachmentBuilder(image, { name: `location.${ext}` })] });
    }
};
