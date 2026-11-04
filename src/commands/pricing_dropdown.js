const { SlashCommandBuilder } = require("discord.js");
const catalog = require("../services/catalog");
const config = require("../services/config");
const { requireSupport } = require("../utils/perms");
const { UserError } = require("../utils/money");
const menu = require("../utils/pricingMenu");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("pricing_dropdown")
        .setDescription("Post the pricing dropdown menus in this channel (staff)"),

    async execute(interaction) {
        requireSupport(interaction.member);

        const entries = await catalog.getTab(menu.MENU_TAB);
        if (!entries.length) throw new UserError("The pricing menu isn't loaded yet. Run `!syncdatabase` first.");

        const header = await config.get("pricing_header_image", process.env.PRICING_HEADER_IMAGE || "");
        const send = async emojis => {
            const chunks = menu.chunkRows(menu.buildMenus(entries, { emojis }));
            await interaction.reply({
                embeds: header ? [{ image: { url: header } }] : [],
                components: chunks[0] || []
            });
            for (const rows of chunks.slice(1)) await interaction.followUp({ components: rows });
        };

        try {
            await send(true);
        } catch (err) {
            // Custom emoji from the sheet that this bot can't use make Discord reject the message.
            if (interaction.replied || interaction.deferred) throw err;
            console.warn("[pricing_dropdown] retrying without emojis:", err.message);
            await send(false);
        }
    }
};
