const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../services/config");
const { requireSupport } = require("../utils/perms");
const { UserError } = require("../utils/money");
const { rows } = require("../utils/box");

const UNITS = { k: 1e3, m: 1e6, b: 1e9 };

/** "3456m" -> 3456, "3.4b" -> 3400, "500k" -> 0.5, "3456" -> 3456 (plain numbers mean millions). Returns millions of GP. */
function parseGp(input) {
    const s = String(input).toLowerCase().replace(/[,\s_]/g, "");
    const m = s.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
    if (!m) return null;
    const millions = (parseFloat(m[1]) * (UNITS[m[2] || "m"])) / 1e6;
    return millions > 0 && Number.isFinite(millions) ? millions : null;
}

const fmtGp = millions => millions >= 1000 ? `${+(millions / 1000).toFixed(3)}B` : `${+millions.toFixed(2)}M`;

module.exports = {
    parseGp, fmtGp,
    data: new SlashCommandBuilder()
        .setName("gp_convert")
        .setDescription("Convert GP to USD (or USD to GP) at the current rate")
        .addStringOption(o => o.setName("amount").setDescription("GP like 3456m, 3.4b, 500k (or $50 for USD to GP)").setRequired(true)),

    async execute(interaction) {
        requireSupport(interaction.member);
        const rate = parseFloat(await config.get("gp_usd_rate", process.env.GP_USD_RATE || "0.18"));
        if (!(rate > 0)) throw new UserError("GP rate is not set. Use `/config set gp_usd_rate 0.18`.");

        const raw = interaction.options.getString("amount").trim();
        let body, title;
        if (raw.startsWith("$")) {
            const usd = parseFloat(raw.slice(1).replace(/,/g, ""));
            if (!(usd > 0)) throw new UserError("Couldn't read that. Try `$50`.");
            body = rows([["USD", "$" + usd.toFixed(2)], ["GP", "🪙 " + fmtGp(usd / rate)], ["Rate", `$${rate} per 1M`]]);
            title = "USD → GP";
        } else {
            const millions = parseGp(raw);
            if (!millions) throw new UserError("Couldn't read that. Try `3456m`, `3.4b` or `500k`.");
            body = rows([["GP", "🪙 " + fmtGp(millions)], ["USD", "💰 $" + (millions * rate).toFixed(2)], ["Rate", `$${rate} per 1M`]]);
            title = "GP → USD";
        }
        const e = new EmbedBuilder().setColor(0x00ffcc).setAuthor({ name: `Converter • ${title}` }).setDescription(body);
        await interaction.reply({ embeds: [e], ephemeral: true });
    }
};
