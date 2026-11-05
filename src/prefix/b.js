const { EmbedBuilder } = require("discord.js");
const catalog = require("../services/catalog");
const { getCalcSettings, splitAmount, lookupInBlocks, footer, describeBlock } = require("../utils/calc");
const { UserError } = require("../utils/money");

const TAB = "PvM";

/** Build the embed description for a PvM lookup. Pure, so it can be tested. */
function describe(found, amount, discountPct, rate) {
    return describeBlock(found, amount, discountPct, rate, [["Boss", found.entry.name]]);
}

module.exports = {
    name: "b",
    describe,
    async execute(message, args) {
        if (!args.length) throw new UserError("Usage: `!b <boss|section> [amount]` (example: `!b vorkath 25` or `!b dt2`)");
        const { query, amount } = splitAmount(args);

        const found = lookupInBlocks(await catalog.getTab(TAB), query);
        if (!found) throw new UserError(`Boss or section "${query}" not found in sheet.`);

        const { rate, discountPct } = await getCalcSettings(message.member);
        const description = describe(found, amount, discountPct, rate);
        if (!description) throw new UserError(`No valid price data found for ${found.entry.name}.`);

        const embed = new EmbedBuilder()
            .setColor(0x00ffcc)
            .setAuthor({ name: "PvM Calculator", iconURL: "https://oldschool.runescape.wiki/images/Combat_icon.png" })
            .setThumbnail(found.entry.data.thumbnail || null)
            .setDescription(description.trim().slice(0, 4096))
            .setFooter(footer(message));
        return message.channel.send({ embeds: [embed] });
    }
};
