const { EmbedBuilder } = require("discord.js");
const catalog = require("../services/catalog");
const { getCalcSettings, splitAmount, withDiscount, lookupInBlocks, pricedOptions, footer } = require("../utils/calc");
const { UserError } = require("../utils/money");

const TAB = "Endgame Kits";

function describe({ entry, option }, amount, discountPct, rate) {
    let d = "`Amount   : " + amount + "`\n";
    d += "`Discount : " + discountPct + "%`\n\n";
    if (entry.data.notes) d += `__**Notes**__\n${entry.data.notes}\n\n`;

    const shown = option ? [option] : pricedOptions(entry);
    if (!shown.length || shown.some(o => !(o.price > 0))) return null;
    return d + shown.map(o => {
        const usd = withDiscount(o.price * amount, discountPct);
        return "`" + o.title + "` " + `💰 $${usd.toFixed(2)} | 🪙 ${(usd / rate).toFixed(2)}M`;
    }).join("\n");
}

module.exports = {
    name: "kits",
    describe,
    async execute(message, args) {
        if (!args.length) throw new UserError("Usage: `!kits <alias|section> [amount]` (example: `!kits sanguine 2` or `!kits blood torva`)");
        // The old bot glued the amount onto the name ("sanguine2") so amounts never matched; split it off first.
        const { query, amount } = splitAmount(args);

        const found = lookupInBlocks(await catalog.getTab(TAB), query);
        if (!found) throw new UserError(`Kit or section "${query}" not found in sheet.`);

        const { rate, discountPct } = await getCalcSettings(message.member);
        const description = describe(found, amount, discountPct, rate);
        if (!description) throw new UserError(`No valid price data found for ${found.entry.name}.`);

        const embed = new EmbedBuilder()
            .setColor(0xe67e22)
            .setAuthor({ name: "Kits Calculator", iconURL: "https://oldschool.runescape.wiki/images/Purifying_sigil_detail.png" })
            .setThumbnail(found.entry.data.thumbnail || null)
            .setDescription(description.trim().slice(0, 4096))
            .setFooter(footer(message));
        return message.channel.send({ embeds: [embed] });
    }
};
