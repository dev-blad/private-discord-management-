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

        await interaction.deferReply({ ephemeral: true });
        const header = await config.get("pricing_header_image", process.env.PRICING_HEADER_IMAGE || "");
        const customOrder = (await config.get("pricing_menu_order", "")).split(",").map(x => x.trim()).filter(Boolean);
        const order = customOrder.length ? customOrder : menu.DEFAULT_ORDER;
        const linkRow = await menu.buildLinkRow();

        const post = async emojis => {
            const rows = menu.buildMenus(entries, { emojis, order });
            const messages = menu.chunkRows(rows);
            // The link buttons ride on the last message if there is room, else get their own.
            if (linkRow) {
                const last = messages[messages.length - 1];
                if (last && last.length < 5) last.push(linkRow); else messages.push([linkRow]);
            }
            // Plain channel messages (not interaction replies) so there is no "used /command" header.
            for (let i = 0; i < messages.length; i++) {
                await interaction.channel.send({
                    embeds: i === 0 && header ? [{ image: { url: header } }] : [],
                    components: messages[i]
                });
            }
            return messages.length;
        };

        let count;
        try {
            count = await post(true);
        } catch (err) {
            // A custom emoji from the sheet that this bot can't use makes Discord reject the message.
            console.warn("[pricing_dropdown] retrying without emojis:", err.message);
            count = await post(false);
        }
        await interaction.editReply(`✅ Posted the pricing menu (${count} message${count === 1 ? "" : "s"}).`);
    }
};
