const { EmbedBuilder } = require("discord.js");
const catalog = require("../services/catalog");
const { getCalcSettings, splitAmount, lookupInBlocks, footer, describeBlock } = require("../utils/calc");
const { UserError } = require("../utils/money");

const TAB = "Raids";

function describe(found, amount, discountPct, rate) {
    return describeBlock(found, amount, discountPct, rate, [["Raid", found.entry.name]]);
}

module.exports = {
    name: "raids",
    describe,
    async execute(message, args) {
        if (!args.length) throw new UserError("Usage: `!raids <alias|section> [amount]` (example: `!raids cox 10`)");
        const { query, amount } = splitAmount(args);

        const found = lookupInBlocks(await catalog.getTab(TAB), query);
        if (!found) throw new UserError(`Raid or section "${query}" not found in sheet.`);

        const { rate, discountPct } = await getCalcSettings(message.member);
        const description = describe(found, amount, discountPct, rate);
        if (!description) throw new UserError(`No valid price data found for ${found.entry.name}.`);

        const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setAuthor({ name: "Raids Calculator", iconURL: "https://oldschool.runescape.wiki/images/Raids.png" })
            .setThumbnail(found.entry.data.thumbnail || null)
            .setDescription(description.trim().slice(0, 4096))
            .setFooter(footer(message));
        return message.channel.send({ embeds: [embed] });
    }
};
