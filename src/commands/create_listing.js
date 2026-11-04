const { SlashCommandBuilder, ChannelType } = require("discord.js");
const accounts = require("../services/accountsales");
const config = require("../services/config");
const { toCents, fmt, UserError } = require("../utils/money");
const { requireSupport } = require("../utils/perms");
const { postListing } = require("../utils/accountCard");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("create_listing")
        .setDescription("List an account for sale (staff)")
        .addStringOption(o => o.setName("type").setDescription("Account type").setRequired(true).addChoices(
            { name: "Main", value: "Main" }, { name: "Pure", value: "Pure" }, { name: "Ironman", value: "Ironman" },
            { name: "Skiller", value: "Skiller" }, { name: "Other", value: "Other" }))
        .addStringOption(o => o.setName("title").setDescription("Short title, e.g. 99 Crafting Pure").setMaxLength(100).setRequired(true))
        .addStringOption(o => o.setName("description").setDescription("Stats, quests, extras").setMaxLength(1500).setRequired(true))
        .addNumberOption(o => o.setName("price").setDescription("Price in USD").setMinValue(1).setMaxValue(100000).setRequired(true))
        .addIntegerOption(o => o.setName("stock").setDescription("How many copies you have (default 1)").setMinValue(1).setMaxValue(100))
        .addStringOption(o => o.setName("image").setDescription("Image URL"))
        .addChannelOption(o => o.setName("channel").setDescription("Where to post it (default: the accounts channel)")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),

    async execute(interaction) {
        requireSupport(interaction.member);
        const image = interaction.options.getString("image");
        if (image && !/^https?:\/\//i.test(image)) throw new UserError("Image must be a http(s) URL.");
        const channelId = interaction.options.getChannel("channel")?.id || await config.get("account_channel_id");
        if (!channelId) throw new UserError("No accounts channel set. Use `/setchannels accounts:` or pick a `channel:`.");

        await interaction.deferReply({ ephemeral: true });
        const a = await accounts.create({
            creatorId: interaction.user.id,
            creatorName: interaction.member?.displayName || interaction.user.username,
            type: interaction.options.getString("type"),
            title: interaction.options.getString("title"),
            description: interaction.options.getString("description"),
            priceCents: toCents(interaction.options.getNumber("price")),
            stock: interaction.options.getInteger("stock") || 1,
            imageUrl: image
        });
        await postListing(interaction.client, a, channelId);
        return interaction.editReply(
            `✅ Listed **${a.id}** at ${fmt(Number(a.price_cents))} in <#${channelId}>.\n` +
            `Add the login details for delivery with \`/account_details id:${a.id}\`.`);
    }
};
