const { EmbedBuilder } = require("discord.js");
const catalog = require("../services/catalog");
const { getCalcSettings, splitAmount, withDiscount, footer } = require("../utils/calc");
const { UserError } = require("../utils/money");

const TAB = "Minigames";
const FALLBACK_THUMB = "https://oldschool.runescape.wiki/images/Miniquests_icon.png";
const AUTHOR_ICON = "https://oldschool.runescape.wiki/images/Minigames.png";

/** One line per priced option: `option (memo)` – $usd | 🪙 gpM */
function calcLines(entry, amount, discountPct, gpUsdRate) {
    const lines = [];
    for (const opt of entry.data.options) {
        if (!opt.price) continue;
        const usd = withDiscount(opt.price * amount, discountPct);
        const memo = opt.memo ? ` (${opt.memo})` : "";
        lines.push(`\`${opt.title}${memo}\` – $${usd.toFixed(2)} | 🪙 ${(usd / gpUsdRate).toFixed(2)}M`);
    }
    return lines;
}

module.exports = {
    name: "mg",
    aliases: ["minigame"],
    calcLines,
    async execute(message, args) {
        if (!args.length) throw new UserError("Usage: `!mg <minigame> [amount]` (example: `!mg pest control 25`)");
        const { query, amount } = splitAmount(args);

        const entry = await catalog.findEntry(TAB, query);
        if (!entry) {
            const near = await catalog.suggest(TAB, query);
            throw new UserError(`Minigame "${query}" not found.${near.length ? ` Did you mean: ${near.map(n => `\`${n}\``).join(", ")}?` : ""}`);
        }

        const { rate, discountPct } = await getCalcSettings(message.member);
        const lines = calcLines(entry, amount, discountPct, rate);
        if (!lines.length) throw new UserError(`No valid price data found for ${entry.name}.`);

        const header = [
            "`Minigame : " + entry.name + "`",
            "`Amount   : " + amount + "`",
            "`Discount : " + discountPct + "%`"
        ].join("\n");

        const embed = new EmbedBuilder()
            .setColor(0x00ffcc)
            .setAuthor({ name: "Minigames Calculator", iconURL: AUTHOR_ICON })
            .setThumbnail(entry.data.thumbnail || FALLBACK_THUMB)
            .setDescription((header + "\n\n" + lines.join("\n")).slice(0, 4096))
            .setFooter(footer(message));

        return message.channel.send({ embeds: [embed] });
    }
};
