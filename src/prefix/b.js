const { EmbedBuilder } = require("discord.js");
const catalog = require("../services/catalog");
const { getCalcSettings, splitAmount, withDiscount, lookupInBlocks, pricedOptions, footer } = require("../utils/calc");
const { UserError } = require("../utils/money");

const TAB = "PvM";

/** Build the embed description for a PvM lookup. Pure, so it can be tested. */
function describe({ entry, option }, amount, discountPct, rate) {
    const line = o => {
        const usd = withDiscount(o.price * amount, discountPct);
        return { usd, gp: usd / rate };
    };
    let d = "`Boss     : " + entry.name + "`\n";
    d += "`Amount   : " + amount + "`\n";
    d += "`Discount : " + discountPct + "%`\n\n";
    if (entry.data.notes) d += `__**Notes**__\n${entry.data.notes}\n\n`;

    const shown = option ? [option] : pricedOptions(entry);
    if (!shown.length || shown.some(o => !(o.price > 0))) return null;
    shown.forEach((o, i) => {
        const { usd, gp } = line(o);
        d += `__${o.title}__\n`;
        d += `Price each: **$${o.price.toFixed(2)}**\n`;
        d += `💰 **$${usd.toFixed(2)}** | 🪙 **${gp.toFixed(2)}M**` + (i < shown.length - 1 ? "\n\n" : "");
    });
    return d;
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
            .setTitle("PVM Calculator")
            .setThumbnail(found.entry.data.thumbnail || null)
            .setDescription(description.trim().slice(0, 4096))
            .setFooter(footer(message));
        return message.channel.send({ embeds: [embed] });
    }
};
